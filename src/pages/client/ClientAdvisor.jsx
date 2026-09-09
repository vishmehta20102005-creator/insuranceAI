import { useState, useEffect, useRef } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import {
  sendAdvisorMessage,
  fetchAdvisorConversations,
  fetchConversationMessages,
} from '../../lib/advisor';
import { fetchPublishedPolicies } from '../../lib/policies';

function formatRelativeTime(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  const now = new Date();
  const diffSec = Math.floor((now - date) / 1000);

  if (diffSec < 60) return 'Just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatFileSize(bytes) {
  if (!bytes) return '';
  const kb = bytes / 1024;
  return kb < 1024 ? `${kb.toFixed(0)} KB` : `${(kb / 1024).toFixed(1)} MB`;
}

function isRecommendationQuery(text = '', hasFile = false) {
  if (hasFile) return true;
  const trimmed = text.trim().toLowerCase();
  if (!trimmed) return false;

  const followUpStarters = [
    'why',
    'what does that mean',
    'can you explain',
    'could you explain',
    'please explain',
    'explain that',
    'explain why',
    'how come',
    'tell me more',
    'what do you mean',
    'why was',
    'why is',
    'why am i',
    'why are',
    "why can't",
    'why cant',
  ];

  const isClarification = followUpStarters.some(
    (starter) => trimmed.startsWith(starter) || trimmed.includes(` ${starter}`)
  );

  const explicitNewSearchKeywords = [
    'find me a policy',
    'find a policy',
    'find policies',
    'search again',
    'check again',
    'recheck',
    'check other',
    'what else is available',
    'what else do you have',
    'other options',
    'other policies',
    'another policy',
    'compare my options',
    'compare options',
    'compare policies',
    'compare all policies',
    'recommend a policy',
    'recommend policies',
    'recommend the best policy',
    'recommend me a policy',
    'suggest a policy',
    'suggest best policy',
    'suggest policies',
    'suggest another policy',
    'which policy should i choose',
    'which policy should i apply',
    'which policy is best for me',
    'what policy is best for me',
    'choose a policy for me',
  ];

  const hasExplicitSearch = explicitNewSearchKeywords.some((kw) => trimmed.includes(kw));

  if (isClarification && !hasExplicitSearch) {
    return false;
  }

  return hasExplicitSearch;
}

/**
 * Normalizes text: strips code-block wrappers, fixes localhost URLs to relative paths,
 * converts single/dangling asterisk headings and labels into proper markdown bold,
 * and fixes dangling unclosed bold tags.
 */
function normalizeMarkdown(text) {
  if (!text) return '';
  let cleaned = text;

  // 0. Merge orphaned bullet markers (•, -, *) followed by newline with the text on the next line
  // e.g. "•\nThe uploaded document" -> "• The uploaded document"
  cleaned = cleaned.replace(/(^[ \t]*[•\-*])[ \t]*\r?\n+[ \t]*([^\r\n#\-*•\d])/gm, '$1 $2');

  // 1. Normalize absolute internal policy links to relative paths
  cleaned = cleaned.replace(/https?:\/\/[^/]+(\/client\/policies\/[a-zA-Z0-9_-]+)/g, '$1');

  // 2. Fix dangling unclosed bold before links: e.g. **[Health](...) without closing **
  cleaned = cleaned.replace(/\*\*(\[[^\]]+\]\([^)]+\))(?!\*\*)/g, '**$1**');

  // Prefix pattern for multiline headings: bullet character (•), dash/plus (- or +), or markdown bullet (* followed by space)
  const P = "(^[ \\t]*(?:[•\\-+]|\\*[ \\t]+)?[ \\t]*)";

  // 3. Standalone single-asterisk headings or labels:
  // e.g. *Applicant Details:* -> **Applicant Details:**
  // e.g. *Ineligibility Assessment Details* -> **Ineligibility Assessment Details**
  // e.g. *1. What is a Deductible?* -> **1. What is a Deductible?**
  cleaned = cleaned.replace(new RegExp(P + "\\*([^*\\r\\n]+)\\*([ \\t]*:|[ \\t]*$)", "gm"), (m, p, content, colon) => {
    return (p || "") + "**" + content.trim() + "**" + (colon ? colon.trim() : "");
  });

  // 4. Single-asterisk label with colon inline:
  // e.g. *Policy:* [Health] -> **Policy:** [Health]
  cleaned = cleaned.replace(/(^|[ \t]+)\*([^*\\r\\n:]+):\*(?=[ \t]|$)/gm, "$1**$2:** ");

  // 5. Trailing asterisk after colon without opening asterisk:
  // e.g. •Name:* Rajesh Kumar -> • **Name:** Rajesh Kumar
  // e.g. Policy:* [Health] -> **Policy:** [Health]
  cleaned = cleaned.replace(new RegExp(P + "([A-Za-z0-9 \\t&/—–\\-()]+):\\*", "gm"), "$1**$2:**");

  // 6. Trailing asterisk at end of line without opening:
  // e.g. • Ineligibility Assessment Details* -> • **Ineligibility Assessment Details**
  // e.g. 1. What is a Deductible?* -> 1. **What is a Deductible?**
  cleaned = cleaned.replace(new RegExp("(^[ \\t]*(?:[•\\-+]|\\*[ \\t]+|\\d+\\.[ \\t]*)?[ \\t]*)([A-Za-z0-9 \\t&/—–\\-()?]+)\\*[ \\t]*$", "gm"), (m, p, c) => {
    return (p || "") + "**" + c.trim() + "**";
  });

  // 7. Unclosed single asterisk at start of line:
  // e.g. *Applicant Details: -> **Applicant Details:**
  cleaned = cleaned.replace(new RegExp(P + "\\*([A-Za-z0-9 \\t&/—–\\-()]+):", "gm"), "$1**$2:**");

  // 8. Clean empty bold tags or double formatting
  cleaned = cleaned.replace(/\*\*[ \\t]*\*\*/g, "");
  cleaned = cleaned.replace(/\*\*:\*\*/g, ":");

  return cleaned;
}

/**
 * Parses markdown-like text into headers, dividers, bullet lists, numbered lists,
 * and inline formatted text (bold, italic, inline code, links).
 * Policy recommendation cards are rendered STRICTLY from recommendedPolicyIds.
 */
function FormattedAssistantMessage({ content, policiesMap = {}, recommendedPolicyIds = [] }) {
  // Check if the response states the applicant is ineligible or disqualified
  const contentLower = (content || '').toLowerCase();
  const isIneligible =
    /ineligib|not eligible|do not meet|does not meet|disqualif|exceeds the maximum|exceeds the limit|cannot recommend|no eligible policies|no policies in our current catalog|would be rejected|no policy suiting|exceeds the hard upper limit|not a recognized insurance|invalid document|restaurant.*menu|unrelated document/i.test(
      contentLower
    );

  const uniqueIds = (!isIneligible && Array.isArray(recommendedPolicyIds))
    ? Array.from(new Set(recommendedPolicyIds))
    : [];

  // Policy recommendation cards are strictly rendered ONLY when the applicant is eligible and policies are recommended
  const policyCards = [];
  for (const policyId of uniqueIds) {
    const policyObj = policiesMap[policyId];
    if (policyObj) {
      policyCards.push({
        id: policyId,
        title: policyObj.name,
        category: policyObj.category || 'Insurance',
        description: policyObj.description || '',
        path: `/client/policies/${policyId}`,
      });
    }
  }

  // Strip wrapping code fences if model enclosed entire response in ``` or '''
  let cleanContent = (content || '').trim();
  if (
    (cleanContent.startsWith('```') && cleanContent.endsWith('```')) ||
    (cleanContent.startsWith("'''") && cleanContent.endsWith("'''"))
  ) {
    cleanContent = cleanContent
      .replace(/^(`{3,}|'{3,})[a-zA-Z]*\n?/, '')
      .replace(/\n?(`{3,}|'{3,})$/, '')
      .trim();
  }

  // Safety repair for historical messages ending with "detail page:" without a link
  if (/detail page:\s*$/i.test(cleanContent) && uniqueIds.length > 0) {
    const matchedPol = policiesMap[uniqueIds[0]];
    if (matchedPol) {
      cleanContent = cleanContent.replace(
        /detail page:\s*$/i,
        `detail page: [Apply for ${matchedPol.name}](/client/policies/${matchedPol.id})`
      );
    }
  }

  // Normalize markdown formatting across full message before line splitting
  cleanContent = normalizeMarkdown(cleanContent);

  const lines = cleanContent.split('\n');

  return (
    <div className="advisor-message-body">
      {lines.map((line, idx) => {
        const trimmed = line.trim();
        if (!trimmed) return <div key={idx} className="advisor-paragraph-spacing" />;

        // Horizontal dividers: ---, ***, ___
        if (/^[-*_]{3,}$/.test(trimmed)) {
          return <hr key={idx} className="advisor-divider" />;
        }

        // Standalone code fences or quote fences: ignore/strip
        if (/^(`{3,}|'{3,})/.test(trimmed)) {
          return null;
        }

        // Headings: #, ##, ###, ####
        if (trimmed.startsWith('# ')) {
          return (
            <h3 key={idx} className="advisor-heading-1">
              {renderInlineFormatting(trimmed.replace(/^#\s+/, ''))}
            </h3>
          );
        }
        if (trimmed.startsWith('## ')) {
          return (
            <h4 key={idx} className="advisor-heading-2">
              {renderInlineFormatting(trimmed.replace(/^##\s+/, ''))}
            </h4>
          );
        }
        if (trimmed.startsWith('### ')) {
          return (
            <h5 key={idx} className="advisor-heading-3">
              {renderInlineFormatting(trimmed.replace(/^###\s+/, ''))}
            </h5>
          );
        }
        if (trimmed.startsWith('#### ')) {
          return (
            <h6 key={idx} className="advisor-heading-4">
              {renderInlineFormatting(trimmed.replace(/^####\s+/, ''))}
            </h6>
          );
        }

        // Bullet list items:
        // Must handle explicit bullet characters (•) or markdown list markers (-, +, *)
        // CRITICAL: A markdown list marker (-, +, *) MUST be followed by whitespace (\s+),
        // and MUST NOT be bold syntax (**), divider (*** or ---), or italic (*word*).
        const isBulletDot = /^•\s*/.test(trimmed);
        const isMarkdownBullet = /^[-+*]\s+/.test(trimmed) && !trimmed.startsWith('***') && !trimmed.startsWith('---') && !trimmed.startsWith('**');

        if (isBulletDot || isMarkdownBullet) {
          const itemText = isBulletDot
            ? trimmed.replace(/^•\s*/, '')
            : trimmed.replace(/^[-+*]\s+/, '');
          
          if (!itemText.trim()) return null;

          return (
            <div key={idx} className="advisor-bullet-item">
              <span className="advisor-bullet-dot" aria-hidden="true">•</span>
              <span className="advisor-bullet-content">{renderInlineFormatting(itemText)}</span>
            </div>
          );
        }

        // Numbered list items (handles "1. ", "2. ", or "**1. ", "**2. ")
        const numberMatch = trimmed.match(/^(?:\*\*)?(\d+\.)[ \t]*(.*)/);
        if (numberMatch) {
          const numPrefix = numberMatch[1];
          const rawRest = numberMatch[2] || '';
          const numText = (trimmed.startsWith('**') && !rawRest.startsWith('**'))
            ? `**${rawRest}`
            : rawRest;
          if (!numText.trim()) return null;
          return (
            <div key={idx} className="advisor-numbered-item">
              <span className="advisor-numbered-prefix">{numPrefix}</span>
              <span className="advisor-numbered-content">{renderInlineFormatting(numText)}</span>
            </div>
          );
        }

        // Standard paragraph
        return (
          <p key={idx} className="advisor-paragraph">
            {renderInlineFormatting(trimmed)}
          </p>
        );
      })}

      {/* Render specialized clickable policy cards ONLY if recommendedPolicyIds has items */}
      {policyCards.length > 0 && (
        <div className="advisor-recommended-cards">
          <div className="advisor-cards-heading">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
            </svg>
            <span>Recommended Policy Option{policyCards.length > 1 ? 's' : ''}</span>
          </div>

          <div className="advisor-cards-grid">
            {policyCards.map((p, i) => (
              <div key={p.id || i} className="advisor-policy-card">
                <div className="advisor-card-top">
                  <span className="badge-category-other">{p.category}</span>
                  <span className="advisor-card-tag">Preliminary Fit</span>
                </div>
                <h4 className="advisor-card-title">{p.title}</h4>
                {p.description && (
                  <p className="advisor-card-desc">{p.description}</p>
                )}
                <Link to={p.path} className="btn btn-primary btn-sm advisor-card-cta">
                  <span>View Policy & Apply</span>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="5" y1="12" x2="19" y2="12" />
                    <polyline points="12 5 19 12 12 19" />
                  </svg>
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Parses inline formatting: [links](url), **bold**, *italic*, `code`, and '''code'''
 */
function renderInlineFormatting(rawText) {
  if (!rawText) return '';
  const text = normalizeMarkdown(rawText);

  // Split by markdown links: [Label](url)
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  const elements = [];
  let lastIdx = 0;
  let match;

  while ((match = linkRegex.exec(text)) !== null) {
    if (match.index > lastIdx) {
      elements.push(...renderFormattedSpan(text.substring(lastIdx, match.index)));
    }
    const linkText = match[1];
    let linkHref = match[2];

    // Normalize any internal paths
    if (linkHref.includes('/client/policies/')) {
      const pIdx = linkHref.indexOf('/client/policies/');
      linkHref = linkHref.substring(pIdx);
    }

    const isInternal = linkHref.startsWith('/');

    if (isInternal) {
      elements.push(
        <Link key={`link-${match.index}`} to={linkHref} className="advisor-inline-link">
          {renderFormattedSpan(linkText)}
        </Link>
      );
    } else {
      elements.push(
        <a
          key={`link-${match.index}`}
          href={linkHref}
          target="_blank"
          rel="noopener noreferrer"
          className="advisor-inline-link"
        >
          {renderFormattedSpan(linkText)}
        </a>
      );
    }
    lastIdx = match.index + match[0].length;
  }

  if (lastIdx < text.length) {
    elements.push(...renderFormattedSpan(text.substring(lastIdx)));
  }

  return elements;
}

function renderFormattedSpan(text) {
  if (!text) return [];

  // Parse bold **...**
  const boldParts = text.split(/(\*\*[^*]+\*\*)/g);
  return boldParts.flatMap((bPart, bIdx) => {
    if (bPart.startsWith('**') && bPart.endsWith('**') && bPart.length >= 4) {
      const innerBold = bPart.slice(2, -2);
      return <strong key={`b-${bIdx}`}>{renderItalicAndCode(innerBold)}</strong>;
    }
    return renderItalicAndCode(bPart);
  });
}

function renderItalicAndCode(text) {
  if (!text) return [];

  // Parse `code` or '''code'''
  const codeParts = text.split(/(`[^`]+`|'''[^']+''')/g);
  return codeParts.flatMap((cPart, cIdx) => {
    if (cPart.startsWith('`') && cPart.endsWith('`') && cPart.length >= 2) {
      return (
        <code key={`c-${cIdx}`} className="advisor-inline-code">
          {cPart.slice(1, -1)}
        </code>
      );
    }
    if (cPart.startsWith("'''") && cPart.endsWith("'''") && cPart.length >= 6) {
      return (
        <code key={`c-${cIdx}`} className="advisor-inline-code">
          {cPart.slice(3, -3)}
        </code>
      );
    }

    // Parse *italic* or _italic_
    const italicParts = cPart.split(/(\*[^*]+\*|_[^_]+_)/g);
    return italicParts.map((iPart, iIdx) => {
      if (
        (iPart.startsWith('*') && iPart.endsWith('*') && iPart.length >= 2) ||
        (iPart.startsWith('_') && iPart.endsWith('_') && iPart.length >= 2)
      ) {
        return <em key={`i-${cIdx}-${iIdx}`}>{iPart.slice(1, -1)}</em>;
      }
      // Strip any lingering lone asterisks adjacent to punctuation or whitespace
      const cleanPart = iPart.replace(/(?:^|\s)\*+(?:\s|$)/g, ' ').replace(/:\*+/g, ':');
      return cleanPart;
    });
  });
}

export default function ClientAdvisor() {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const conversationIdFromUrl = searchParams.get('id');

  // State
  const [conversations, setConversations] = useState([]);
  const [activeConversationId, setActiveConversationId] = useState(conversationIdFromUrl || null);
  const [messages, setMessages] = useState([]);
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [isRecovering, setIsRecovering] = useState(false);
  const [loadingStatusText, setLoadingStatusText] = useState('Thinking...');
  const [error, setError] = useState('');

  // Input & attachments
  const MAX_DOCS_LIMIT = 5;
  const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB per file limit to protect AI performance
  const MAX_TOTAL_SIZE_BYTES = 12 * 1024 * 1024; // 12MB combined limit

  const [inputMessage, setInputMessage] = useState('');
  const [attachedFiles, setAttachedFiles] = useState([]);
  const [policiesMap, setPoliciesMap] = useState({});

  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const inputRef = useRef(null);

  // Prevent accidental page refresh/close while AI is actively generating response
  useEffect(() => {
    if (!sending) return;
    const handleBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [sending]);

  // Auto-recovery: If user refreshed while AI was generating, poll for completed response
  useEffect(() => {
    if (loadingMessages || sending || !activeConversationId || messages.length === 0) return;

    const lastMsg = messages[messages.length - 1];
    if (lastMsg && lastMsg.role === 'user' && !lastMsg.isOptimistic) {
      setIsRecovering(true);
      let attempts = 0;
      const interval = setInterval(async () => {
        attempts++;
        try {
          const freshMsgs = await fetchConversationMessages(activeConversationId);
          if (freshMsgs.length > 0) {
            const latest = freshMsgs[freshMsgs.length - 1];
            if (latest.role === 'assistant') {
              setMessages(freshMsgs);
              setIsRecovering(false);
              clearInterval(interval);
              return;
            }
          }
        } catch (e) {
          console.error('Polling for completed assistant response:', e);
        }

        if (attempts >= 5) {
          setIsRecovering(false);
          clearInterval(interval);
        }
      }, 2500);

      return () => clearInterval(interval);
    } else {
      setIsRecovering(false);
    }
  }, [messages, activeConversationId, loadingMessages, sending]);

  // 1. Initial load: fetch conversations and published policies
  useEffect(() => {
    loadInitialData();
  }, []);

  // 2. When activeConversationId changes, load messages and update URL
  useEffect(() => {
    if (activeConversationId) {
      setSearchParams({ id: activeConversationId }, { replace: true });
      loadConversationMessages(activeConversationId);
    } else {
      setMessages([]);
      setSearchParams({}, { replace: true });
    }
  }, [activeConversationId]);

  // 3. Scroll to bottom on new message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending, isRecovering]);

  async function loadInitialData() {
    setLoadingConversations(true);
    try {
      const [convList, pubPolicies] = await Promise.all([
        fetchAdvisorConversations(),
        fetchPublishedPolicies(),
      ]);

      setConversations(convList);

      const pMap = {};
      (pubPolicies || []).forEach((p) => {
        pMap[p.id] = p;
      });
      setPoliciesMap(pMap);

      // If URL had no id but conversations exist, pick the most recent one
      if (!conversationIdFromUrl && convList.length > 0) {
        setActiveConversationId(convList[0].id);
      }
    } catch (err) {
      console.error('Failed to load advisor data:', err);
      setError('Could not load chat history. Please try again.');
    } finally {
      setLoadingConversations(false);
    }
  }

  async function loadConversationMessages(convId) {
    setLoadingMessages(true);
    setError('');
    try {
      const msgs = await fetchConversationMessages(convId);
      setMessages(msgs);
    } catch (err) {
      console.error('Failed to load messages:', err);
      setError('Could not load messages for this conversation.');
    } finally {
      setLoadingMessages(false);
    }
  }

  function handleStartNewChat() {
    setActiveConversationId(null);
    setMessages([]);
    setError('');
    setAttachedFiles([]);
    setInputMessage('');
    if (inputRef.current) inputRef.current.focus();
  }

  function handleFilesSelected(e) {
    const selected = Array.from(e.target.files || []);
    if (selected.length === 0) return;

    setError('');

    // Check count limit
    if (attachedFiles.length + selected.length > MAX_DOCS_LIMIT) {
      setError(`You can upload a maximum of ${MAX_DOCS_LIMIT} documents at once.`);
      e.target.value = '';
      return;
    }

    // Check 5MB per-file limit
    for (const f of selected) {
      if (f.size > MAX_FILE_SIZE_BYTES) {
        setError(`"${f.name}" exceeds the 5MB size limit (${formatFileSize(f.size)}). Please upload documents under 5MB each.`);
        e.target.value = '';
        return;
      }
    }

    // Check total combined size limit (12MB)
    const currentTotal = attachedFiles.reduce((sum, f) => sum + f.size, 0);
    const newTotal = selected.reduce((sum, f) => sum + f.size, 0);
    if (currentTotal + newTotal > MAX_TOTAL_SIZE_BYTES) {
      setError(`Total upload size exceeds 12MB limit (${formatFileSize(currentTotal + newTotal)}). Please compress or remove some files.`);
      e.target.value = '';
      return;
    }

    // Append unique files
    setAttachedFiles((prev) => {
      const existingKeys = new Set(prev.map((f) => `${f.name}_${f.size}`));
      const uniqueNew = selected.filter((f) => !existingKeys.has(`${f.name}_${f.size}`));
      return [...prev, ...uniqueNew];
    });

    e.target.value = '';
  }

  function handleRemoveAttachedFile(indexToRemove) {
    setAttachedFiles((prev) => prev.filter((_, idx) => idx !== indexToRemove));
  }

  async function handleSendMessage(e, overrideText = null) {
    if (e) e.preventDefault();
    const textToSend = (overrideText !== null ? overrideText : inputMessage).trim();
    if (!textToSend && attachedFiles.length === 0) return;
    if (sending) return;

    setError('');
    const currentFiles = overrideText === null ? [...attachedFiles] : [];
    if (overrideText === null) {
      setAttachedFiles([]);
    }

    const userDisplayContent = textToSend || (
      currentFiles.length === 1
        ? `[Attached document: ${currentFiles[0].name}]`
        : `[Attached ${currentFiles.length} documents: ${currentFiles.map((f) => f.name).join(', ')}]`
    );

    // Optimistically show user message only for newly typed queries
    let tempUserMsg = null;
    if (overrideText === null) {
      const displayAttachments = currentFiles.map((f) => ({
        filename: f.name,
        size: f.size,
      }));
      tempUserMsg = {
        id: `temp-${Date.now()}`,
        role: 'user',
        content: userDisplayContent,
        created_at: new Date().toISOString(),
        isOptimistic: true,
        attachments: displayAttachments,
        attachmentName: displayAttachments.length === 1 ? displayAttachments[0].filename : undefined,
      };
      setMessages((prev) => [...prev, tempUserMsg]);
      setInputMessage('');
    }

    // Conditionally set loading indicator text
    const hasFiles = currentFiles.length > 0;
    const isDocAnalysis = isRecommendationQuery(textToSend, hasFiles);
    setLoadingStatusText(
      hasFiles
        ? (currentFiles.length > 1 ? `Reviewing ${currentFiles.length} uploaded documents...` : 'Reviewing uploaded document...')
        : (isDocAnalysis ? 'Finding matching policies...' : 'Thinking...')
    );

    setSending(true);

    try {
      const result = await sendAdvisorMessage({
        conversationId: activeConversationId,
        message: textToSend,
        files: currentFiles,
      });

      if (result) {
        if (!activeConversationId && result.conversation_id) {
          setActiveConversationId(result.conversation_id);
        }

        // Refresh conversation list so any newly generated or updated title appears in the sidebar immediately
        const updatedConvs = await fetchAdvisorConversations();
        setConversations(updatedConvs);

        if (result.messages && result.messages.length > 0) {
          if (currentFiles.length > 0) {
            const lastUserIdx = [...result.messages].reverse().findIndex((m) => m.role === 'user');
            if (lastUserIdx !== -1) {
              const actualIdx = result.messages.length - 1 - lastUserIdx;
              if (!result.messages[actualIdx].attachments || result.messages[actualIdx].attachments.length === 0) {
                result.messages[actualIdx].attachments = currentFiles.map((f) => ({
                  filename: f.name,
                  size: f.size,
                }));
              }
            }
          }
          setMessages(result.messages);
        }
      }
    } catch (err) {
      console.error('Send error:', err);
      setError('Failed to get a response from the Advisor. Please try again.');
      // Remove optimistic message if failed
      if (tempUserMsg) {
        setMessages((prev) => prev.filter((m) => m.id !== tempUserMsg.id));
        setInputMessage(textToSend);
        setAttachedFiles(currentFiles);
      }
    } finally {
      setSending(false);
      setIsRecovering(false);
    }
  }

  function handleQuickPrompt(promptText) {
    setInputMessage(promptText);
    if (inputRef.current) inputRef.current.focus();
  }

  async function handleSignOut() {
    await signOut();
    navigate('/login', { replace: true });
  }

  const activeConv = conversations.find((c) => c.id === activeConversationId);

  return (
    <div className="dashboard-layout">
      {/* ── Header ── */}
      <header className="dashboard-header">
        <div className="dashboard-header-inner">
          <div className="dashboard-brand">
            <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
              <rect width="32" height="32" rx="8" fill="var(--color-accent)" />
              <path d="M16 6L22 10V18L16 26L10 18V10L16 6Z" fill="white" opacity="0.9" />
              <path d="M16 10L19 12.5V17.5L16 22L13 17.5V12.5L16 10Z" fill="var(--color-accent)" />
            </svg>
            <span className="dashboard-brand-name">InsuranceAI</span>
            <span className="advisor-header-tag">Policy Advisor</span>
          </div>

          <div className="advisor-header-nav">
            <Link to="/client/policies" className="advisor-nav-link">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <line x1="9" y1="9" x2="15" y2="9" />
                <line x1="9" y1="13" x2="15" y2="13" />
                <line x1="9" y1="17" x2="13" y2="17" />
              </svg>
              <span>Browse Policies</span>
            </Link>
            <Link to="/client/advisor" className="advisor-nav-link active">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              <span>AI Advisor</span>
            </Link>
          </div>

          <div className="dashboard-user">
            <span className="dashboard-user-name">{profile?.full_name || profile?.email}</span>
            <button onClick={handleSignOut} className="btn btn-ghost btn-sm">Sign out</button>
          </div>
        </div>
      </header>

      {/* ── Main App Shell ── */}
      <div className="advisor-shell">
        {/* ── Sidebar: Conversation History ── */}
        <aside className="advisor-sidebar">
          <div className="advisor-sidebar-top">
            <button onClick={handleStartNewChat} className="btn btn-primary advisor-new-chat-btn">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              <span>New Consultation</span>
            </button>
          </div>

          <div className="advisor-sidebar-content">
            <div className="advisor-section-label">Your Consultations</div>

            {loadingConversations ? (
              <div className="advisor-history-skeleton">
                <div className="skeleton-line" />
                <div className="skeleton-line" style={{ width: '80%' }} />
                <div className="skeleton-line" style={{ width: '60%' }} />
              </div>
            ) : conversations.length === 0 ? (
              <div className="advisor-no-history">
                <p>No past consultations yet.</p>
                <small>Conversations will appear here as you chat.</small>
              </div>
            ) : (
              <div className="advisor-history-list">
                {conversations.map((c) => {
                  const isActive = c.id === activeConversationId;
                  return (
                    <button
                      key={c.id}
                      onClick={() => setActiveConversationId(c.id)}
                      className={`advisor-history-item ${isActive ? 'active' : ''}`}
                    >
                      <div className="advisor-history-item-header">
                        <span className="advisor-history-title">{c.title || 'Untitled Consultation'}</span>
                      </div>
                      <span className="advisor-history-time">{formatRelativeTime(c.updated_at)}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </aside>

        {/* ── Chat Container ── */}
        <div className="advisor-main-area">
          {/* Chat Header */}
          <div className="advisor-chat-topbar">
            <div className="advisor-chat-meta">
              <div className="advisor-status-indicator">
                <span className="advisor-status-dot" />
                <span className="advisor-status-label">Policy Advisor AI</span>
              </div>
              <h2 className="advisor-chat-title">
                {activeConv ? activeConv.title : 'New Policy Consultation'}
              </h2>
            </div>
            <div className="advisor-chat-badge-info">
              <span>Preliminary Guidance Tool</span>
            </div>
          </div>

          {/* Messages List */}
          <div className="advisor-messages-container">
            {loadingMessages ? (
              <div className="advisor-loading-messages">
                <div className="spinner" />
                <span>Loading conversation...</span>
              </div>
            ) : messages.length === 0 ? (
              <div className="advisor-welcome-screen">
                <div className="advisor-welcome-icon">
                  <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="1.75">
                    <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
                  </svg>
                </div>
                <h3>Welcome to InsuranceAI Policy Advisor</h3>
                <p>
                  I can answer insurance questions, explain coverage concepts, and evaluate your documents
                  against our official published policies to recommend the ideal match.
                </p>

                <div className="advisor-quick-prompts">
                  <span className="advisor-quick-label">Try asking:</span>
                  <div className="advisor-prompt-chips">
                    <button
                      type="button"
                      className="advisor-chip"
                      onClick={() => handleQuickPrompt("What is the difference between a deductible and a copay?")}
                    >
                      "What is the difference between deductible and copay?"
                    </button>
                    <button
                      type="button"
                      className="advisor-chip"
                      onClick={() => handleQuickPrompt("Which health insurance policy covers hospitalization and pre-existing conditions?")}
                    >
                      "Which policy covers hospitalization & pre-existing illnesses?"
                    </button>
                    <button
                      type="button"
                      className="advisor-chip"
                      onClick={() => handleQuickPrompt("I am a 30-year-old looking for comprehensive health coverage. What do you recommend?")}
                    >
                      "I'm 30 years old looking for comprehensive health coverage."
                    </button>
                    <button
                      type="button"
                      className="advisor-chip"
                      onClick={() => {
                        handleQuickPrompt("I've attached my profile document. Which published policy best suits my requirements?");
                        fileInputRef.current?.click();
                      }}
                    >
                      📎 "Upload a document to find the best-fitting policy"
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="advisor-messages-thread">
                {messages.map((msg, index) => {
                  const isUser = msg.role === 'user';
                  return (
                    <div key={msg.id || index} className={`advisor-message-row ${isUser ? 'user-row' : 'assistant-row'}`}>
                      {!isUser && (
                        <div className="advisor-avatar">
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect width="18" height="18" rx="4" />
                            <circle cx="9" cy="9" r="1.5" />
                            <circle cx="15" cy="9" r="1.5" />
                            <path d="M8 14s1.5 2 4 2 4-2 4-2" />
                          </svg>
                        </div>
                      )}

                      <div className={`advisor-bubble ${isUser ? 'user-bubble' : 'assistant-bubble'}`}>
                        {isUser ? (
                          <div className="advisor-user-text">
                            {msg.attachments && msg.attachments.length > 0 ? (
                              <div className="advisor-msg-attachments-wrap">
                                {msg.attachments.map((att, attIdx) => (
                                  <div key={attIdx} className="advisor-msg-attachment-chip">
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                                    </svg>
                                    <span className="advisor-att-chip-name">{att.filename}</span>
                                    {att.size ? <span className="advisor-att-chip-size">({formatFileSize(att.size)})</span> : null}
                                  </div>
                                ))}
                              </div>
                            ) : msg.attachmentName ? (
                              <div className="advisor-msg-attachment-chip">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                                </svg>
                                <span>{msg.attachmentName}</span>
                              </div>
                            ) : null}
                            <div className="advisor-user-content">{msg.content}</div>
                          </div>
                        ) : (
                          <FormattedAssistantMessage
                            content={msg.content}
                            policiesMap={policiesMap}
                            recommendedPolicyIds={msg.recommended_policy_ids || []}
                          />
                        )}

                        <span className="advisor-msg-timestamp">
                          {formatRelativeTime(msg.created_at)}
                        </span>
                      </div>
                    </div>
                  );
                })}

                {(sending || isRecovering) && (
                  <div className="advisor-message-row assistant-row">
                    <div className="advisor-avatar">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect width="18" height="18" rx="4" />
                        <circle cx="9" cy="9" r="1.5" />
                        <circle cx="15" cy="9" r="1.5" />
                        <path d="M8 14s1.5 2 4 2 4-2 4-2" />
                      </svg>
                    </div>
                    <div className="advisor-bubble assistant-bubble advisor-typing-bubble">
                      <div className="advisor-typing-dots">
                        <span />
                        <span />
                        <span />
                      </div>
                      <span className="advisor-typing-text">
                        {isRecovering ? 'Checking for AI response...' : loadingStatusText}
                      </span>
                    </div>
                  </div>
                )}

                {/* Show regenerate button if response was interrupted on reload and polling ended */}
                {!sending && !isRecovering && messages.length > 0 && messages[messages.length - 1].role === 'user' && (
                  <div className="advisor-interrupted-banner">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="8" x2="12" y2="12" />
                        <line x1="12" y1="16" x2="12.01" y2="16" />
                      </svg>
                      <span>Response was interrupted when the page refreshed.</span>
                    </div>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => handleSendMessage(null, messages[messages.length - 1].content)}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                      </svg>
                      <span>Regenerate Response</span>
                    </button>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          {/* Error Banner */}
          {error && (
            <div className="advisor-error-banner">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>{error}</span>
            </div>
          )}

          {/* ── Input Box & Disclaimer ── */}
          <div className="advisor-input-panel">
            {/* Attachment preview if files are selected */}
            {attachedFiles.length > 0 && (
              <div className="advisor-staged-attachments-container">
                <div className="advisor-staged-header">
                  <span className="advisor-staged-count">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                    </svg>
                    <span>
                      {attachedFiles.length} of {MAX_DOCS_LIMIT} documents attached (
                      {formatFileSize(attachedFiles.reduce((sum, f) => sum + f.size, 0))} / 12MB limit)
                    </span>
                  </span>
                  {attachedFiles.length < MAX_DOCS_LIMIT && (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="advisor-add-more-btn"
                    >
                      + Add more
                    </button>
                  )}
                </div>
                <div className="advisor-staged-chips-list">
                  {attachedFiles.map((file, idx) => (
                    <div key={`${file.name}_${idx}`} className="advisor-staged-chip">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                      </svg>
                      <span className="advisor-staged-chip-name" title={file.name}>{file.name}</span>
                      <span className="advisor-staged-chip-size">({formatFileSize(file.size)})</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveAttachedFile(idx)}
                        className="advisor-staged-chip-remove"
                        title="Remove document"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <form onSubmit={handleSendMessage} className="advisor-form-row">
              {/* Paperclip attachment button */}
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFilesSelected}
                style={{ display: 'none' }}
                multiple
                accept=".pdf,.png,.jpg,.jpeg,.doc,.docx"
              />

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className={`advisor-attach-button ${attachedFiles.length > 0 ? 'has-file' : ''}`}
                title={`Attach documents (up to ${MAX_DOCS_LIMIT} files, max 5MB each)`}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                </svg>
                {attachedFiles.length > 0 && (
                  <span className="advisor-attach-badge">{attachedFiles.length}</span>
                )}
              </button>

              <input
                ref={inputRef}
                type="text"
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                placeholder={
                  attachedFiles.length > 0
                    ? `Add notes or questions about these ${attachedFiles.length} document${attachedFiles.length > 1 ? 's' : ''}...`
                    : "Ask an insurance question or attach documents to verify eligibility..."
                }
                className="advisor-text-input"
                disabled={sending}
              />

              <button
                type="submit"
                disabled={sending || (!inputMessage.trim() && attachedFiles.length === 0)}
                className="btn btn-primary advisor-send-button"
              >
                <span>Send</span>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </button>
            </form>

            {/* Persistent Disclaimer */}
            <div className="advisor-disclaimer-bar">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>
                <strong>Preliminary suggestion only.</strong> This AI Advisor offers non-binding educational guidance. To receive an official eligibility decision, apply through the official policy application page.
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
