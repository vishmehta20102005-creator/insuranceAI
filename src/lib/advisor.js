import { supabase } from './supabase';

/**
 * Send a message to the policy-advisor-chat Edge Function.
 *
 * @param {Object} params
 * @param {string|null} [params.conversationId] - Existing conversation ID or null to create one
 * @param {string} params.message - User's message text
 * @param {File|null} [params.file] - Optional single uploaded file (legacy)
 * @param {File[]} [params.files] - Optional list of uploaded files
 * @returns {Promise<{ conversation_id: string, messages: Array, attachments: Array }>}
 */
export async function sendAdvisorMessage({ conversationId = null, message = '', file = null, files = [] }) {
  let bodyPayload = {
    conversation_id: conversationId,
    message,
  };

  const fileList = Array.isArray(files) && files.length > 0 ? files : (file ? [file] : []);

  if (fileList.length > 0) {
    const encodedAttachments = await Promise.all(
      fileList.map(async (f) => {
        const base64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = reader.result;
            const base64Data = result.includes(',') ? result.split(',')[1] : result;
            resolve(base64Data);
          };
          reader.onerror = (err) => reject(err);
          reader.readAsDataURL(f);
        });
        return {
          filename: f.name,
          base64,
          mime_type: f.type || 'application/octet-stream',
        };
      })
    );

    bodyPayload.attachments = encodedAttachments;
    // Also include single attachment for legacy Edge Function compatibility
    if (encodedAttachments.length === 1) {
      bodyPayload.attachment = encodedAttachments[0];
    }
  }

  const { data, error } = await supabase.functions.invoke('policy-advisor-chat', {
    body: bodyPayload,
  });

  if (error) {
    console.error('Error in policy-advisor-chat function invoke:', error);
    throw error;
  }

  return data;
}

/**
 * Fetch all conversations for the authenticated client.
 */
export async function fetchAdvisorConversations() {
  const { data, error } = await supabase
    .from('chat_conversations')
    .select('*')
    .order('updated_at', { ascending: false });

  if (error) {
    console.error('Error fetching chat conversations:', error);
    throw error;
  }

  return data || [];
}

/**
 * Fetch all messages for a specific conversation.
 */
export async function fetchConversationMessages(conversationId) {
  if (!conversationId) return [];

  const [{ data: messages, error: msgErr }, { data: attachments, error: attErr }] =
    await Promise.all([
      supabase
        .from('chat_messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true }),
      supabase
        .from('chat_attachments')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('uploaded_at', { ascending: true }),
    ]);

  if (msgErr) {
    console.error('Error fetching conversation messages:', msgErr);
    throw msgErr;
  }

  if (attErr) {
    console.warn('Error fetching conversation attachments:', attErr);
  }

  const attachmentsPool = [...(attachments || [])];

  return (messages || []).map((msg) => {
    let content = msg.content || '';
    let recommended_policy_ids = [];
    let attachmentName = '';
    let attachmentPath = '';

    // 1. Check embedded RECOMMENDED_POLICIES
    const recMatch = content.match(/<!--RECOMMENDED_POLICIES:(.*?)-->/);
    if (recMatch) {
      try {
        recommended_policy_ids = JSON.parse(recMatch[1]);
      } catch {
        // ignore
      }
      content = content.replace(/<!--RECOMMENDED_POLICIES:.*?-->/, '').trim();
    }

    // 2. Check embedded ATTACHMENTS (multiple) or ATTACHMENT (single)
    let attachmentsList = [];
    const multiAttMatch = content.match(/<!--ATTACHMENTS:(.*?)-->/);
    if (multiAttMatch) {
      try {
        attachmentsList = JSON.parse(multiAttMatch[1]);
      } catch {
        // ignore
      }
      content = content.replace(/<!--ATTACHMENTS:.*?-->/, '').trim();
    }

    const attMatch = content.match(/<!--ATTACHMENT:(.*?)-->/);
    if (attMatch) {
      try {
        const parsed = JSON.parse(attMatch[1]);
        attachmentName = parsed.filename || '';
        attachmentPath = parsed.file_path || '';
        if (attachmentsList.length === 0) {
          attachmentsList.push(parsed);
        }
      } catch {
        // ignore
      }
      content = content.replace(/<!--ATTACHMENT:.*?-->/, '').trim();
    }

    if (attachmentsList.length > 0 && !attachmentName) {
      attachmentName = attachmentsList[0]?.filename || '';
      attachmentPath = attachmentsList[0]?.file_path || '';
    }

    // 3. Fallback for legacy messages: match closest chat_attachment for user messages
    if (!attachmentName && attachmentsList.length === 0 && msg.role === 'user' && attachmentsPool.length > 0) {
      const msgTime = new Date(msg.created_at).getTime();
      const matchIdx = attachmentsPool.findIndex((att) => {
        const attTime = new Date(att.uploaded_at).getTime();
        return Math.abs(msgTime - attTime) <= 15000;
      });

      if (matchIdx !== -1) {
        const matched = attachmentsPool.splice(matchIdx, 1)[0];
        attachmentName = matched.filename;
        attachmentPath = matched.file_path;
        attachmentsList.push({ filename: matched.filename, file_path: matched.file_path });
      }
    }

    return {
      ...msg,
      content,
      attachmentName: attachmentName || undefined,
      attachmentPath: attachmentPath || undefined,
      attachments: attachmentsList.length > 0 ? attachmentsList : undefined,
      recommended_policy_ids,
    };
  });
}

/**
 * Fetch all attachments for a specific conversation.
 */
export async function fetchConversationAttachments(conversationId) {
  if (!conversationId) return [];

  const { data, error } = await supabase
    .from('chat_attachments')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('uploaded_at', { ascending: true });

  if (error) {
    console.error('Error fetching conversation attachments:', error);
    throw error;
  }

  return data || [];
}
