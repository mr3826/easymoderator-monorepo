/**
 * InboxComposer — Message input bar with attachment, voice, quick templates.
 * Extracted from UnifiedInbox.tsx (D2 split).
 *
 * Animations:
 * - successPulse on the send button after a successful send
 * - errorShake on the composer wrapper when policy denies the message
 * - Deny reason shown as a readable string (via getDenyMessage), never a stack trace
 */
import { useRef, useState, ChangeEvent } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Send, Loader2, Tag, X, Paperclip, Mic, StopCircle, Zap, AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import type { ResponseTemplate } from "@/api/types/conversation";
import type { Conversation } from "@/api/types/conversation";
import { apiClient } from "@/api";
import { successPulse, errorShake } from "@/lib/motion";
import { getDenyMessage } from "@/lib/policy/deny-messages";

interface InboxComposerProps {
  selectedConversation: Conversation;
  is24hExpired: boolean;
  is24hWarning: boolean;
  quickReplyTemplates: ResponseTemplate[];
  loadingTemplates: boolean;
  planFeaturesAdvancedAI: boolean;
  onMessageSent: (message: import("@/api/types/conversation").Message) => void;
}

const fileToDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Attachment read failed"));
    reader.readAsDataURL(file);
  });

const blobToBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const encoded = result.includes(",") ? result.split(",")[1] : result;
      if (!encoded) { reject(new Error("Audio conversion failed")); return; }
      resolve(encoded);
    };
    reader.onerror = () => reject(new Error("Audio conversion failed"));
    reader.readAsDataURL(blob);
  });

export function InboxComposer({
  selectedConversation,
  is24hExpired,
  is24hWarning,
  quickReplyTemplates,
  loadingTemplates,
  onMessageSent,
}: InboxComposerProps) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "bn" ? "bn" : "en";

  const [editingMessage, setEditingMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [selectedMessageTag, setSelectedMessageTag] = useState("");
  const [selectedAttachment, setSelectedAttachment] = useState<File | null>(null);
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [isTranscribingVoice, setIsTranscribingVoice] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [showQuickReplies, setShowQuickReplies] = useState(false);

  // Motion states
  const [sendState, setSendState] = useState<"idle" | "pulse">("idle");
  const [shakeState, setShakeState] = useState<"idle" | "shake">("idle");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const quickReplyRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);
  const isSendingRef = useRef(false);

  const handleAttachmentClear = () => {
    setSelectedAttachment(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleAttachmentPick = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null;
    if (!file) return;
    setSelectedAttachment(file);
  };

  const handleStartVoiceRecording = async () => {
    try {
      setVoiceError(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };
      recorder.onstop = async () => {
        const chunks = [...audioChunksRef.current];
        audioChunksRef.current = [];
        stream.getTracks().forEach((t) => t.stop());
        if (chunks.length === 0) { setIsRecordingVoice(false); return; }
        try {
          setIsTranscribingVoice(true);
          const audioBlob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
          const audioBase64 = await blobToBase64(audioBlob);
          const data = await apiClient.transcribeVoice({
            messageId: `draft-${Date.now()}`,
            audioBase64,
            language: "auto",
          });
          if (data.transcript?.trim()) {
            setEditingMessage((prev) =>
              prev.trim() ? `${prev.trim()} ${data.transcript.trim()}` : data.transcript.trim()
            );
            toast.success("Voice converted to text");
          }
        } catch {
          const msg = "Voice transcription failed";
          setVoiceError(msg);
          toast.error(msg);
        } finally {
          setIsTranscribingVoice(false);
          setIsRecordingVoice(false);
        }
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecordingVoice(true);
    } catch {
      const msg = "Microphone access denied";
      setVoiceError(msg);
      toast.error(msg);
    }
  };

  const handleStopVoiceRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
  };

  const handleSendMessage = async (overrideContent?: string) => {
    const trimmed = (overrideContent ?? editingMessage).trim();
    const hasAttachment = !!selectedAttachment;
    if (!selectedConversation || (!trimmed && !hasAttachment) || isSendingRef.current) return;
    isSendingRef.current = true;
    if (is24hExpired && !selectedMessageTag) {
      toast.error(t("inbox.errors.selectTag"));
      isSendingRef.current = false;
      return;
    }
    try {
      setIsSending(true);
      setSendError(null);
      let messageType: "text" | "image" | "file" | "location" = "text";
      let metadata: Record<string, unknown> | undefined;
      let content = trimmed;

      if (selectedAttachment) {
        const dataUrl = await fileToDataUrl(selectedAttachment);
        const isImage = selectedAttachment.type.startsWith("image/");
        messageType = isImage ? "image" : "file";
        metadata = {
          message_type: messageType,
          file_name: selectedAttachment.name,
          mime_type: selectedAttachment.type || "application/octet-stream",
          file_size: selectedAttachment.size,
          file_url: dataUrl,
          ...(isImage ? { image_url: dataUrl } : {}),
        };
        if (!content) content = selectedAttachment.name;
      }

      const payload: Parameters<typeof apiClient.createMessage>[1] = {
        content,
        sender: "agent",
        message_type: messageType,
        ...(metadata ? { metadata } : {}),
        ...(selectedMessageTag ? { message_tag: selectedMessageTag as never } : {}),
      };
      const message = await apiClient.createMessage(selectedConversation.id, payload);
      onMessageSent(message);
      setEditingMessage("");
      setSelectedMessageTag("");
      handleAttachmentClear();
      // Success pulse on send button
      setSendState("pulse");
      setTimeout(() => setSendState("idle"), 600);
    } catch (err: unknown) {
      const rawMsg =
        (err as { isRateLimited?: boolean; response?: { data?: { error?: { message?: string } } }; message?: string })
          ?.response?.data?.error?.message ||
        (err as { message?: string })?.message ||
        "";
      const friendly = getDenyMessage(rawMsg || "error", lang as "bn" | "en");
      setSendError(friendly);
      toast.error(friendly);
      // Error shake on composer
      setShakeState("shake");
      setTimeout(() => setShakeState("idle"), 600);
    } finally {
      isSendingRef.current = false;
      setIsSending(false);
    }
  };

  const resolveTemplateContent = (template: ResponseTemplate): string => {
    const customerName = selectedConversation?.customer?.name || "Customer";
    return template.content
      .replaceAll("{{customer_name}}", customerName)
      .replaceAll("{{name}}", customerName);
  };

  const handleQuickTemplateSend = async (template: ResponseTemplate) => {
    const rendered = resolveTemplateContent(template).trim();
    if (!rendered) return;
    setShowQuickReplies(false);
    await handleSendMessage(rendered);
  };

  return (
    <div className="bg-white border-t border-gray-200 p-4 shrink-0">
      {(is24hWarning || is24hExpired) && (
        <div className="mb-3 flex items-center gap-2">
          <Tag className="w-4 h-4 text-gray-400 flex-shrink-0" />
          <select
            value={selectedMessageTag}
            onChange={(e) => setSelectedMessageTag(e.target.value)}
            className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">
              {is24hExpired ? t("inbox.messageTagRequired") : t("inbox.messageTagOptional")}
            </option>
            <option value="CONFIRMED_EVENT_UPDATE">Confirmed Event Update</option>
            <option value="POST_PURCHASE_UPDATE">Post-Purchase Update</option>
            <option value="ACCOUNT_UPDATE">Account Update</option>
            <option value="HUMAN_AGENT">Human Agent</option>
          </select>
        </div>
      )}
      {selectedAttachment && (
        <div className="mb-3 inline-flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
          {selectedAttachment.type.startsWith("image/") ? "🖼️" : "📎"}
          <span className="max-w-56 truncate">{selectedAttachment.name}</span>
          <button onClick={handleAttachmentClear} className="text-blue-700 hover:text-blue-900" aria-label="Remove attachment">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
      {voiceError && (
        <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{voiceError}</div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv"
        onChange={handleAttachmentPick}
      />
      <AnimatePresence>
        {sendError && (
          <motion.div
            key="send-error"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="mb-3 text-sm text-destructive flex items-center gap-1 font-bn overflow-hidden"
          >
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            <span>{sendError}</span>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div
        className="flex items-center gap-2 md:gap-3 relative"
        variants={errorShake}
        animate={shakeState}
      >
        {/* Quick Reply popup */}
        {showQuickReplies && (
          <div
            ref={quickReplyRef}
            className="absolute bottom-full left-0 mb-2 w-72 max-w-[calc(100vw-2rem)] bg-white border border-gray-200 rounded-xl shadow-xl z-20 overflow-hidden"
          >
            <div className="px-3 py-2 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-600">Templates</span>
              <button onClick={() => setShowQuickReplies(false)} className="text-gray-400 hover:text-gray-600 text-xs" aria-label="Close templates">
                <X className="w-3 h-3" />
              </button>
            </div>
            <div className="max-h-48 overflow-y-auto divide-y divide-gray-50">
              {loadingTemplates && (
                <div className="px-3 py-2 text-xs text-gray-500">Loading templates...</div>
              )}
              {quickReplyTemplates.map((template) => (
                <button
                  key={template.id}
                  onClick={() => handleQuickTemplateSend(template)}
                  className="w-full text-left px-3 py-2.5 text-sm text-gray-700 hover:bg-blue-50 hover:text-blue-700 transition-colors leading-snug"
                >
                  <div className="font-medium text-gray-900">{template.name}</div>
                  <div className="line-clamp-2 text-xs text-gray-500 mt-1">{template.content}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        <button
          onClick={() => setShowQuickReplies((v) => !v)}
          title="Quick Reply"
          aria-label="Quick reply templates"
          className="p-2.5 text-amber-500 hover:text-amber-600 hover:bg-amber-50 border border-gray-300 rounded-xl transition-colors flex-shrink-0 min-h-[44px] min-w-[44px] flex items-center justify-center"
        >
          <Zap className="w-4 h-4" />
        </button>
        <button
          onClick={() => fileInputRef.current?.click()}
          title="Attach file"
          aria-label="Attach file"
          className="p-2.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 border border-gray-300 rounded-xl transition-colors flex-shrink-0 min-h-[44px] min-w-[44px] flex items-center justify-center"
        >
          <Paperclip className="w-4 h-4" />
        </button>
        <button
          onClick={isRecordingVoice ? handleStopVoiceRecording : handleStartVoiceRecording}
          title={isRecordingVoice ? "Stop recording" : "Start voice recording"}
          aria-label={isRecordingVoice ? "Stop voice recording" : "Start voice recording"}
          disabled={isTranscribingVoice}
          className={`p-2.5 border rounded-xl transition-colors flex-shrink-0 min-h-[44px] min-w-[44px] flex items-center justify-center ${
            isRecordingVoice
              ? "text-red-600 border-red-300 bg-red-50 hover:bg-red-100"
              : "text-gray-500 border-gray-300 hover:text-blue-600 hover:bg-blue-50"
          } ${isTranscribingVoice ? "opacity-50 cursor-not-allowed" : ""}`}
        >
          {isRecordingVoice ? <StopCircle className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
        </button>
        <input
          type="text"
          value={editingMessage}
          onChange={(e) => setEditingMessage(e.target.value)}
          placeholder={
            isTranscribingVoice
              ? "Transcribing voice..."
              : is24hExpired && !selectedMessageTag
              ? t("inbox.messageTagPlaceholder")
              : t("inbox.messagePlaceholder")
          }
          disabled={is24hExpired && !selectedMessageTag}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSendMessage();
            }
          }}
          className={`flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
            is24hExpired && !selectedMessageTag ? "bg-gray-100 cursor-not-allowed" : ""
          }`}
        />
        <motion.button
          onClick={() => handleSendMessage()}
          aria-label={isSending ? t("inbox.sending") : t("inbox.send")}
          disabled={
            isSending ||
            (!editingMessage.trim() && !selectedAttachment) ||
            (is24hExpired && !selectedMessageTag)
          }
          variants={successPulse}
          animate={sendState}
          className={`px-4 md:px-6 py-3 bg-blue-600 text-white rounded-lg flex items-center gap-2 min-h-[44px] flex-shrink-0 ${
            isSending || (!editingMessage.trim() && !selectedAttachment) || (is24hExpired && !selectedMessageTag)
              ? "opacity-60 cursor-not-allowed"
              : "hover:bg-blue-700"
          }`}
        >
          {isSending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
          <span className="hidden sm:inline">{isSending ? t("inbox.sending") : t("inbox.send")}</span>
        </motion.button>
      </motion.div>
    </div>
  );
}
