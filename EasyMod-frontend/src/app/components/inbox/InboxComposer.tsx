/**
 * InboxComposer — Message input bar with attachment and quick templates.
 */
import { useRef, useState, ChangeEvent } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Send, Loader2, X, Paperclip, Zap, AlertTriangle, Search, Pencil,
  Trash2, Plus, Save, FileText, Image as ImageIcon,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import type { ResponseTemplate } from "@/api/types/conversation";
import type { Conversation, Message } from "@/api/types/conversation";
import { apiClient } from "@/api";
import { successPulse, errorShake } from "@/lib/motion";
import { getDenyMessage } from "@/lib/policy/deny-messages";

interface InboxComposerProps {
  selectedConversation: Conversation;
  is24hExpired: boolean;
  is24hWarning: boolean;
  templates: ResponseTemplate[];
  quickReplyTemplates: ResponseTemplate[];
  loadingTemplates: boolean;
  planFeaturesAdvancedAI: boolean;
  onMessageSent: (message: Message) => void;
  onTemplatesChanged: () => Promise<void>;
}

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const SUPPORTED_ATTACHMENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

const emptyTemplateForm = { name: "", content: "", category: "Quick Reply" };

const fileToDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Attachment read failed"));
    reader.readAsDataURL(file);
  });

export function InboxComposer({
  selectedConversation,
  is24hExpired,
  is24hWarning,
  templates,
  quickReplyTemplates,
  loadingTemplates,
  onMessageSent,
  onTemplatesChanged,
}: InboxComposerProps) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "bn" ? "bn" : "en";

  const [editingMessage, setEditingMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [sendPhase, setSendPhase] = useState<"idle" | "uploading" | "sending">("idle");
  const [sendError, setSendError] = useState<string | null>(null);
  const [selectedAttachment, setSelectedAttachment] = useState<File | null>(null);
  const [showQuickReplies, setShowQuickReplies] = useState(false);
  const [quickSearch, setQuickSearch] = useState("");
  const [showTemplateManager, setShowTemplateManager] = useState(false);
  const [templateSearch, setTemplateSearch] = useState("");
  const [templateForm, setTemplateForm] = useState(emptyTemplateForm);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [templateSaving, setTemplateSaving] = useState(false);
  const [deletingTemplateId, setDeletingTemplateId] = useState<string | null>(null);

  const [sendState, setSendState] = useState<"idle" | "pulse">("idle");
  const [shakeState, setShakeState] = useState<"idle" | "shake">("idle");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const quickReplyRef = useRef<HTMLDivElement>(null);
  const isSendingRef = useRef(false);

  const filteredQuickTemplates = quickReplyTemplates.filter((template) => {
    const query = quickSearch.trim().toLowerCase();
    if (!query) return true;
    return `${template.name} ${template.content} ${template.category || ""}`.toLowerCase().includes(query);
  });

  const filteredManagedTemplates = templates.filter((template) => {
    const query = templateSearch.trim().toLowerCase();
    if (!query) return true;
    return `${template.name} ${template.content} ${template.category || ""}`.toLowerCase().includes(query);
  });

  const handleAttachmentClear = () => {
    setSelectedAttachment(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleAttachmentPick = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null;
    if (!file) return;
    if (!SUPPORTED_ATTACHMENT_TYPES.has(file.type)) {
      toast.error("This file type is not supported for Messenger.");
      event.target.value = "";
      return;
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      toast.error("Attachment must be 25MB or smaller.");
      event.target.value = "";
      return;
    }
    setSelectedAttachment(file);
  };

  const handleSendMessage = async () => {
    const trimmed = editingMessage.trim();
    const hasAttachment = !!selectedAttachment;
    if (!selectedConversation || (!trimmed && !hasAttachment) || isSendingRef.current) return;
    isSendingRef.current = true;
    if (is24hExpired) {
      toast.error(t("inbox.errors.outsideWindowDisabled"));
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
        setSendPhase("uploading");
        const dataUrl = await fileToDataUrl(selectedAttachment);
        const isImage = selectedAttachment.type.startsWith("image/");
        messageType = isImage ? "image" : "file";
        metadata = {
          message_type: messageType,
          file_name: selectedAttachment.name,
          mime_type: selectedAttachment.type,
          file_size: selectedAttachment.size,
          file_data_url: dataUrl,
          delivery_status: "pending",
        };
        if (!content) content = selectedAttachment.name;
      }

      setSendPhase("sending");
      const message = await apiClient.createMessage(selectedConversation.id, {
        content,
        sender: "agent",
        message_type: messageType,
        ...(metadata ? { metadata } : {}),
      });
      onMessageSent(message);
      setEditingMessage("");
      handleAttachmentClear();
      setSendState("pulse");
      setTimeout(() => setSendState("idle"), 600);
    } catch (err: unknown) {
      const rawMsg =
        (err as { response?: { data?: { error?: { message?: string } } }; message?: string })
          ?.response?.data?.error?.message ||
        (err as { message?: string })?.message ||
        "";
      const friendly = getDenyMessage(rawMsg || "error", lang as "bn" | "en");
      setSendError(friendly);
      toast.error(friendly);
      setShakeState("shake");
      setTimeout(() => setShakeState("idle"), 600);
    } finally {
      isSendingRef.current = false;
      setIsSending(false);
      setSendPhase("idle");
    }
  };

  const resolveTemplateContent = (template: ResponseTemplate): string => {
    const customerName = selectedConversation?.customer?.name || "Customer";
    return template.content
      .replaceAll("{{customer_name}}", customerName)
      .replaceAll("{{name}}", customerName);
  };

  const handleTemplateInsert = (template: ResponseTemplate) => {
    const rendered = resolveTemplateContent(template).trim();
    if (!rendered) return;
    setEditingMessage(rendered);
    setShowQuickReplies(false);
  };

  const resetTemplateForm = () => {
    setTemplateForm(emptyTemplateForm);
    setEditingTemplateId(null);
  };

  const handleEditTemplate = (template: ResponseTemplate) => {
    setEditingTemplateId(template.id);
    setTemplateForm({
      name: template.name,
      content: template.content,
      category: template.category || "Quick Reply",
    });
  };

  const handleSaveTemplate = async () => {
    const name = templateForm.name.trim();
    const content = templateForm.content.trim();
    if (!name || !content) {
      toast.error("Template name and message are required.");
      return;
    }
    try {
      setTemplateSaving(true);
      if (editingTemplateId) {
        await apiClient.updateTemplate(editingTemplateId, {
          name,
          content,
          category: templateForm.category.trim() || "Quick Reply",
          is_active: true,
        });
      } else {
        await apiClient.createTemplate({
          name,
          content,
          category: templateForm.category.trim() || "Quick Reply",
          variables: [],
          is_active: true,
        });
      }
      await onTemplatesChanged();
      resetTemplateForm();
      toast.success("Template saved.");
    } catch (err: unknown) {
      toast.error((err as { message?: string })?.message || "Template save failed.");
    } finally {
      setTemplateSaving(false);
    }
  };

  const handleDeleteTemplate = async (templateId: string) => {
    try {
      setDeletingTemplateId(templateId);
      await apiClient.deleteTemplate(templateId);
      await onTemplatesChanged();
      if (editingTemplateId === templateId) resetTemplateForm();
      toast.success("Template deleted.");
    } catch (err: unknown) {
      toast.error((err as { message?: string })?.message || "Template delete failed.");
    } finally {
      setDeletingTemplateId(null);
    }
  };

  const sendLabel = sendPhase === "uploading" ? "Uploading" : sendPhase === "sending" ? t("inbox.sending") : t("inbox.send");

  return (
    <div className="bg-white border-t border-gray-200 p-4 shrink-0">
      {(is24hWarning || is24hExpired) && (
        <div className={`mb-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${
          is24hExpired
            ? "border-red-200 bg-red-50 text-red-700"
            : "border-amber-200 bg-amber-50 text-amber-700"
        }`}>
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>{is24hExpired ? t("inbox.outsideWindowDisabled") : t("inbox.windowWarning")}</span>
        </div>
      )}
      {selectedAttachment && (
        <div className="mb-3 inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
          {selectedAttachment.type.startsWith("image/") ? <ImageIcon className="w-4 h-4" /> : <FileText className="w-4 h-4" />}
          <span className="max-w-56 truncate">{selectedAttachment.name}</span>
          <button onClick={handleAttachmentClear} className="text-blue-700 hover:text-blue-900" aria-label="Remove attachment">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        accept="image/jpeg,image/png,image/gif,image/webp,application/pdf,text/plain,text/csv,.doc,.docx,.xls,.xlsx"
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
        {showQuickReplies && (
          <div
            ref={quickReplyRef}
            className="absolute bottom-full left-0 mb-2 w-80 max-w-[calc(100vw-2rem)] bg-white border border-gray-200 rounded-lg shadow-xl z-20 overflow-hidden"
          >
            <div className="px-3 py-2 border-b border-gray-100 bg-gray-50 flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-gray-600">Templates</span>
              <button
                onClick={() => setShowTemplateManager(true)}
                className="text-xs text-blue-700 hover:text-blue-900 font-medium"
              >
                Manage Templates
              </button>
              <button onClick={() => setShowQuickReplies(false)} className="text-gray-400 hover:text-gray-600" aria-label="Close templates">
                <X className="w-3 h-3" />
              </button>
            </div>
            <div className="p-2 border-b border-gray-100">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-2 top-2.5 text-gray-400" />
                <input
                  value={quickSearch}
                  onChange={(e) => setQuickSearch(e.target.value)}
                  placeholder="Search templates"
                  className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            <div className="max-h-56 overflow-y-auto divide-y divide-gray-50">
              {loadingTemplates && (
                <div className="px-3 py-2 text-xs text-gray-500">Loading templates...</div>
              )}
              {filteredQuickTemplates.map((template) => (
                <button
                  key={template.id}
                  onClick={() => handleTemplateInsert(template)}
                  className="w-full text-left px-3 py-2.5 text-sm text-gray-700 hover:bg-blue-50 hover:text-blue-700 transition-colors leading-snug"
                >
                  <div className="font-medium text-gray-900">{template.name}</div>
                  <div className="line-clamp-2 text-xs text-gray-500 mt-1">{template.content}</div>
                </button>
              ))}
              {!loadingTemplates && filteredQuickTemplates.length === 0 && (
                <div className="px-3 py-3 text-xs text-gray-500">No templates found.</div>
              )}
            </div>
          </div>
        )}

        <button
          onClick={() => setShowQuickReplies((v) => !v)}
          title="Quick Reply"
          aria-label="Quick reply templates"
          className="p-2.5 text-amber-500 hover:text-amber-600 hover:bg-amber-50 border border-gray-300 rounded-lg transition-colors flex-shrink-0 min-h-[44px] min-w-[44px] flex items-center justify-center"
        >
          <Zap className="w-4 h-4" />
        </button>
        <button
          onClick={() => fileInputRef.current?.click()}
          title="Attach file"
          aria-label="Attach file"
          className="p-2.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 border border-gray-300 rounded-lg transition-colors flex-shrink-0 min-h-[44px] min-w-[44px] flex items-center justify-center"
        >
          <Paperclip className="w-4 h-4" />
        </button>
        <input
          type="text"
          value={editingMessage}
          onChange={(e) => setEditingMessage(e.target.value)}
          placeholder={is24hExpired ? t("inbox.outsideWindowPlaceholder") : t("inbox.messagePlaceholder")}
          disabled={is24hExpired}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSendMessage();
            }
          }}
          className={`flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
            is24hExpired ? "bg-gray-100 cursor-not-allowed" : ""
          }`}
        />
        <motion.button
          onClick={handleSendMessage}
          aria-label={isSending ? sendLabel : t("inbox.send")}
          disabled={
            isSending ||
            (!editingMessage.trim() && !selectedAttachment) ||
            is24hExpired
          }
          variants={successPulse}
          animate={sendState}
          className={`px-4 md:px-6 py-3 bg-blue-600 text-white rounded-lg flex items-center gap-2 min-h-[44px] flex-shrink-0 ${
            isSending || (!editingMessage.trim() && !selectedAttachment) || is24hExpired
              ? "opacity-60 cursor-not-allowed"
              : "hover:bg-blue-700"
          }`}
        >
          {isSending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
          <span className="hidden sm:inline">{sendLabel}</span>
        </motion.button>
      </motion.div>

      {showTemplateManager && (
        <div
          className="fixed inset-0 bg-gray-900/50 z-50 flex justify-end"
          onClick={(event) => {
            if (event.target === event.currentTarget) setShowTemplateManager(false);
          }}
        >
          <div className="h-full w-full max-w-lg bg-white shadow-2xl flex flex-col">
            <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-900">Manage Templates</h2>
              <button onClick={() => setShowTemplateManager(false)} className="text-gray-500 hover:text-gray-700" aria-label="Close template manager">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 border-b border-gray-100 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input
                  value={templateForm.name}
                  onChange={(e) => setTemplateForm((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="Template name"
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <input
                  value={templateForm.category}
                  onChange={(e) => setTemplateForm((prev) => ({ ...prev, category: e.target.value }))}
                  placeholder="Category"
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <textarea
                value={templateForm.content}
                onChange={(e) => setTemplateForm((prev) => ({ ...prev, content: e.target.value }))}
                placeholder="Template message"
                rows={4}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={handleSaveTemplate}
                  disabled={templateSaving}
                  className="inline-flex items-center gap-2 px-3 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-60"
                >
                  {templateSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : editingTemplateId ? <Save className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                  {editingTemplateId ? "Save" : "Create"}
                </button>
                {editingTemplateId && (
                  <button
                    onClick={resetTemplateForm}
                    className="px-3 py-2 border border-gray-300 text-gray-700 text-sm rounded-lg hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>
            <div className="p-5 border-b border-gray-100">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-2.5 text-gray-400" />
                <input
                  value={templateSearch}
                  onChange={(e) => setTemplateSearch(e.target.value)}
                  placeholder="Search templates"
                  className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto divide-y divide-gray-100">
              {filteredManagedTemplates.map((template) => (
                <div key={template.id} className="p-4 flex items-start gap-3">
                  <button
                    onClick={() => handleTemplateInsert(template)}
                    className="flex-1 text-left min-w-0"
                  >
                    <div className="text-sm font-semibold text-gray-900 truncate">{template.name}</div>
                    <div className="text-xs text-gray-500 mt-0.5">{template.category || "Quick Reply"}</div>
                    <div className="text-sm text-gray-700 mt-2 line-clamp-3">{template.content}</div>
                  </button>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => handleEditTemplate(template)}
                      className="p-2 text-gray-500 hover:text-blue-700 hover:bg-blue-50 rounded-lg"
                      aria-label={`Edit ${template.name}`}
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDeleteTemplate(template.id)}
                      disabled={deletingTemplateId === template.id}
                      className="p-2 text-gray-500 hover:text-red-700 hover:bg-red-50 rounded-lg disabled:opacity-50"
                      aria-label={`Delete ${template.name}`}
                    >
                      {deletingTemplateId === template.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              ))}
              {!loadingTemplates && filteredManagedTemplates.length === 0 && (
                <div className="p-5 text-sm text-gray-500">No saved templates found.</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
