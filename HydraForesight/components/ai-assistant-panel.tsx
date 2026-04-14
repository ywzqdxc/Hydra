"use client"

import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react"
import { Bot, FileImage, FileText, Loader2, Paperclip, Send, User, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { MarkdownContent } from "@/components/markdown-content"
import { request } from "@/lib/api/request"
import { cn } from "@/lib/utils"

interface AIAssistantPanelProps {
  onClose?: () => void
  className?: string
}

type MessageRole = "user" | "assistant"
type AttachmentKind = "image" | "document"

interface MessageAttachment {
  id: string
  kind: AttachmentKind
  name: string
  previewUrl?: string
}

interface PendingAttachment extends MessageAttachment {
  file: File
}

interface ChatAttachmentPayload {
  kind: AttachmentKind
  name: string
  mimeType: string
  url?: string
  textContent?: string
}

interface Message {
  id: string
  role: MessageRole
  content: string
  reasoning?: string
  attachments?: MessageAttachment[]
  pending?: boolean
}

interface StreamEvent {
  event: string
  data: string
}

interface StreamHandlers {
  onToken?: (chunk: string) => void
  onReasoning?: (chunk: string) => void
  onDone?: (payload: { content?: string; reasoning?: string }) => void
  onError?: (message: string) => void
}

const MAX_ATTACHMENTS = 5
const MAX_ATTACHMENT_SIZE = 20 * 1024 * 1024

const WELCOME_MESSAGE =
  "您好，我是智水先知智能助手。您可以直接提问，也可以上传图片、PDF、Word、Excel、PPT、TXT、Markdown 等附件，我会结合内容一起分析。"

const SUGGESTED_QUESTIONS = [
  "请结合当前系统能力，给我一份城市内涝应急处置要点。",
  "帮我解读一下上传图片里的现场情况，并指出风险点。",
  "请总结附件文档的重点内容，并给出行动建议。",
  "暴雨来临前，值班人员需要重点检查哪些事项？",
]

function createId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function isImageFile(file: File) {
  return file.type.startsWith("image/")
}

function createMessageAttachments(attachments: PendingAttachment[]): MessageAttachment[] {
  return attachments.map(({ id, kind, name, previewUrl }) => ({
    id,
    kind,
    name,
    previewUrl,
  }))
}

function buildHistoryContent(message: Message) {
  const attachmentLabel =
    message.attachments && message.attachments.length > 0
      ? `\n\n本轮附件：${message.attachments.map((item) => item.name).join("、")}`
      : ""

  return `${message.content}${attachmentLabel}`.trim()
}

function isLocalPreview() {
  if (typeof window === "undefined") return false
  return window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
}

async function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ""))
    reader.onerror = () => reject(new Error(`读取文件 ${file.name} 失败`))
    reader.readAsDataURL(file)
  })
}

async function buildAttachmentPayload(attachments: PendingAttachment[]): Promise<ChatAttachmentPayload[]> {
  return Promise.all(
    attachments.map(async (attachment) => {
      const payload: ChatAttachmentPayload = {
        kind: attachment.kind,
        name: attachment.name,
        mimeType: attachment.file.type || "application/octet-stream",
      }

      if (
        attachment.file.type.startsWith("text/") ||
        [".txt", ".md", ".csv", ".json", ".html", ".xml"].some((extension) =>
          attachment.name.toLowerCase().endsWith(extension)
        )
      ) {
        payload.textContent = (await attachment.file.text()).slice(0, 20000)
      }

      if (isLocalPreview()) {
        payload.url = await fileToDataUrl(attachment.file)
        return payload
      }

      const formData = new FormData()
      formData.append("file", attachment.file)
      formData.append("subDir", "ai-assistant")

      const uploaded = await request.upload<{ url: string }>("/file/upload", formData)
      payload.url = uploaded.url

      return payload
    })
  )
}

function parseSSEMessages(buffer: string) {
  const chunks = buffer.split(/\r?\n\r?\n/)
  const remainder = chunks.pop() ?? ""
  const events = chunks
    .map((chunk): StreamEvent | null => {
      let event = "message"
      const dataLines: string[] = []

      for (const line of chunk.split(/\r?\n/)) {
        if (line.startsWith("event:")) {
          event = line.slice(6).trim()
          continue
        }

        if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).trimStart())
        }
      }

      if (dataLines.length === 0) {
        return null
      }

      return {
        event,
        data: dataLines.join("\n"),
      }
    })
    .filter((event): event is StreamEvent => event !== null)

  return { events, remainder }
}

async function readResponseError(response: Response) {
  const contentType = response.headers.get("content-type") || ""

  if (contentType.includes("application/json")) {
    const data = await response.json().catch(() => null)
    return data?.details || data?.error || `请求失败(${response.status})`
  }

  const text = await response.text().catch(() => "")
  return text || `请求失败(${response.status})`
}

async function consumeAssistantStream(response: Response, handlers: StreamHandlers) {
  if (!response.body) {
    throw new Error("当前环境不支持流式响应。")
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  while (true) {
    const { done, value } = await reader.read()

    buffer += decoder.decode(value || new Uint8Array(), { stream: !done })

    const parsed = parseSSEMessages(buffer)
    buffer = parsed.remainder

    for (const event of parsed.events) {
      const payload = JSON.parse(event.data) as { content?: string; message?: string; reasoning?: string }

      if (event.event === "token" && payload.content) {
        handlers.onToken?.(payload.content)
      }

      if (event.event === "reasoning" && payload.content) {
        handlers.onReasoning?.(payload.content)
      }

      if (event.event === "error") {
        handlers.onError?.(payload.message || "流式响应中断，请稍后再试。")
      }

      if (event.event === "done") {
        handlers.onDone?.({
          content: payload.content,
          reasoning: payload.reasoning,
        })
      }
    }

    if (done) {
      break
    }
  }

  if (buffer.trim()) {
    const parsed = parseSSEMessages(`${buffer}\n\n`)

    for (const event of parsed.events) {
      const payload = JSON.parse(event.data) as { content?: string; message?: string; reasoning?: string }

      if (event.event === "token" && payload.content) {
        handlers.onToken?.(payload.content)
      }

      if (event.event === "reasoning" && payload.content) {
        handlers.onReasoning?.(payload.content)
      }

      if (event.event === "error") {
        handlers.onError?.(payload.message || "流式响应中断，请稍后再试。")
      }

      if (event.event === "done") {
        handlers.onDone?.({
          content: payload.content,
          reasoning: payload.reasoning,
        })
      }
    }
  }
}

export default function AIAssistantPanel({ onClose, className }: AIAssistantPanelProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: createId(),
      role: "assistant",
      content: WELCOME_MESSAGE,
    },
  ])
  const [input, setInput] = useState("")
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [composerError, setComposerError] = useState("")
  const fileInputRef = useRef<HTMLInputElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const pendingAttachmentsRef = useRef<PendingAttachment[]>([])

  const [showSuggestions, setShowSuggestions] = useState(true);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  useEffect(() => {
    pendingAttachmentsRef.current = pendingAttachments
  }, [pendingAttachments])

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort()

      pendingAttachmentsRef.current.forEach((attachment) => {
        if (attachment.previewUrl) {
          URL.revokeObjectURL(attachment.previewUrl)
        }
      })
    }
  }, [])

  const historyPayload = useMemo(
    () =>
      messages
        .filter((message) => !message.pending)
        .map((message) => ({
          role: message.role,
          content: buildHistoryContent(message),
        }))
        .slice(-10),
    [messages]
  )

  const removePendingAttachment = (attachmentId: string) => {
    setPendingAttachments((current) => {
      const target = current.find((attachment) => attachment.id === attachmentId)
      if (target?.previewUrl) {
        URL.revokeObjectURL(target.previewUrl)
      }

      return current.filter((attachment) => attachment.id !== attachmentId)
    })
  }

  const updateAssistantMessage = (messageId: string, content: string, reasoning = "") => {
    setMessages((current) =>
      current.map((message) =>
        message.id === messageId
          ? {
              id: messageId,
              role: "assistant",
              content,
              reasoning,
            }
          : message
      )
    )
  }

  const handleFileSelect = (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files || [])
    event.target.value = ""

    if (selectedFiles.length === 0) {
      return
    }

    setComposerError("")

    setPendingAttachments((current) => {
      const next = [...current]

      for (const file of selectedFiles) {
        if (next.length >= MAX_ATTACHMENTS) {
          setComposerError(`最多上传 ${MAX_ATTACHMENTS} 个附件。`)
          break
        }

        if (file.size > MAX_ATTACHMENT_SIZE) {
          setComposerError(`文件 ${file.name} 超过 20MB，暂未添加。`)
          continue
        }

        next.push({
          id: createId(),
          file,
          kind: isImageFile(file) ? "image" : "document",
          name: file.name,
          previewUrl: isImageFile(file) ? URL.createObjectURL(file) : undefined,
        })
      }

      return next
    })
  }

  const handleSendMessage = async (rawContent?: string) => {
    const content = typeof rawContent === "string" ? rawContent.trim() : input.trim()

    if (!content && pendingAttachments.length === 0) {
      return
    }

    const prompt = content || "请帮我分析我上传的附件内容，并总结重点结论。"
    const userAttachments = [...pendingAttachments]
    const userMessage: Message = {
      id: createId(),
      role: "user",
      content: prompt,
      attachments: createMessageAttachments(userAttachments),
    }
    const placeholderId = createId()

    setMessages((current) => [
      ...current,
      userMessage,
      {
        id: placeholderId,
        role: "assistant",
        content: "正在分析中，请稍候...",
        pending: true,
      },
    ])
    setInput("")
    setPendingAttachments([])
    setComposerError("")
    setIsLoading(true)

    try {
      abortControllerRef.current?.abort()
      const controller = new AbortController()
      abortControllerRef.current = controller
      const attachments = await buildAttachmentPayload(userAttachments)

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        signal: controller.signal,
        body: JSON.stringify({
          message: prompt,
          history: historyPayload,
          attachments,
        }),
      })

      if (!response.ok) {
        throw new Error(await readResponseError(response))
      }

      let streamedContent = ""
      let streamedReasoning = ""
      let streamError = ""

      await consumeAssistantStream(response, {
        onToken: (chunk) => {
          streamedContent += chunk
          updateAssistantMessage(placeholderId, streamedContent || "正在分析中，请稍候...", streamedReasoning)
        },
        onReasoning: (chunk) => {
          streamedReasoning += chunk
        },
        onError: (message) => {
          streamError = message
        },
        onDone: (payload) => {
          if (payload.content) {
            streamedContent = payload.content
          }

          if (payload.reasoning) {
            streamedReasoning = payload.reasoning
          }
        },
      })

      if (streamError) {
        throw new Error(streamError)
      }

      updateAssistantMessage(
        placeholderId,
        streamedContent || "抱歉，我暂时无法回答这个问题。",
        streamedReasoning
      )
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return
      }

      console.error("聊天请求失败:", error)
      updateAssistantMessage(placeholderId, error instanceof Error ? error.message : "处理请求时出现异常，请稍后再试。")
    } finally {
      abortControllerRef.current = null
      setIsLoading(false)
    }
  }

  return (
    <Card
      className={cn(
        "flex h-full w-full flex-col overflow-hidden border-slate-200 bg-white text-slate-950 shadow-2xl dark:border-slate-800 dark:bg-slate-950 dark:text-slate-50"
      )}
    >
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-300">
              <Bot className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-lg">智水先知智能助手</CardTitle>
              <CardDescription className="mt-1 text-xs">
                支持文字问答、图片理解、文档摘要与附件联动分析
              </CardDescription>
            </div>
          </div>

          {onClose ? (
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
              <X className="h-4 w-4" />
              <span className="sr-only">关闭智能助手</span>
            </Button>
          ) : null}
        </div>
      </CardHeader>

      <Tabs 
        defaultValue="chat" 
        className={cn("flex flex-col w-full h-full min-h-0", className)}
      >
        <TabsList className="mx-4 grid w-auto grid-cols-2 shrink-0">
          <TabsTrigger value="chat">对话</TabsTrigger>
          <TabsTrigger value="help">帮助</TabsTrigger>
        </TabsList>

        <TabsContent value="chat" className="mt-2 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
      <CardContent className="min-h-0 flex-1 px-4 pb-0">
        <ScrollArea className="h-full pr-3">
          <div className="space-y-4 py-2">
            {messages.map((message) => (
              <div key={message.id} className={`flex ${message.role === "assistant" ? "justify-start" : "justify-end"}`}>
                <div
                  className={`max-w-[88%] rounded-2xl border px-4 py-3 shadow-sm ${
                    message.role === "assistant"
                      ? "border-slate-200 bg-white text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-50"
                      : "border-blue-600 bg-blue-600 text-white"
                  }`}
                >
                  <div className="mb-2 flex items-center gap-2 text-xs font-medium opacity-80">
                    {message.role === "assistant" ? <Bot className="h-4 w-4" /> : <User className="h-4 w-4" />}
                    <span>{message.role === "assistant" ? "智水先知助手" : "您"}</span>
                  </div>

                  {message.attachments && message.attachments.length > 0 ? (
                    <div className="mb-3 space-y-2">
                      {message.attachments.map((attachment) => (
                        <div
                          key={attachment.id}
                          className={`rounded-xl border px-3 py-2 ${
                            message.role === "assistant"
                              ? "border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900"
                              : "border-blue-300/40 bg-blue-500/30"
                          }`}
                        >
                          <div className="flex items-center gap-2 text-xs">
                            {attachment.kind === "image" ? <FileImage className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
                            <span className="truncate">{attachment.name}</span>
                          </div>

                          {attachment.kind === "image" && attachment.previewUrl ? (
                            <img src={attachment.previewUrl} alt={attachment.name} className="mt-2 max-h-40 rounded-lg object-cover" />
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {message.role === "assistant" ? (
                    <MarkdownContent content={message.content} />
                  ) : (
                    <p className="text-sm whitespace-pre-wrap leading-6">{message.content}</p>
                  )}
                </div>
              </div>
            ))}

            <div ref={messagesEndRef} />
          </div>
        </ScrollArea>
      </CardContent>

      <CardFooter className="flex flex-col gap-4 p-4">
        {showSuggestions && (
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-wrap gap-2">
              {SUGGESTED_QUESTIONS.map((question) => (
                <Button
                  key={question}
                  variant="outline"
                  size="sm"
                  className="h-8 rounded-full bg-transparent text-xs"
                  disabled={isLoading}
                  onClick={() => handleSendMessage(question)}
                >
                  {question}
                </Button>
              ))}
            </div>
            <Button
            variant="ghost"  // 使用透明背景变体（如果是 shadcn/ui）
            size="sm"
            className="h-8 w-8 shrink-0 rounded-full p-0 text-gray-500 hover:text-gray-900"
            onClick={() => setShowSuggestions(false)} // 点击隐藏
            aria-label="关闭建议"
          >
            {/* 使用图标库的 X，或者直接写 "✕" */}
            <X className="h-4 w-4" /> 
          </Button>
          </div>
        )}

        <div className="w-full rounded-2xl border border-border bg-white p-3 shadow-sm dark:bg-slate-950">
          <Textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault()
                handleSendMessage()
              }
            }}
            placeholder="请输入您的问题，或上传图片/文件后直接发送..."
            className="min-h-[96px] resize-none border-0 px-0 py-0 shadow-none focus-visible:ring-0"
            disabled={isLoading}
          />

          {pendingAttachments.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {pendingAttachments.map((attachment) => (
                <div
                  key={attachment.id}
                  className="flex max-w-full items-center gap-2 rounded-full border border-border bg-muted px-3 py-1.5 text-xs"
                >
                  {attachment.kind === "image" ? <FileImage className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}
                  <span className="max-w-[180px] truncate">{attachment.name}</span>
                  <button
                    type="button"
                    className="text-muted-foreground transition hover:text-foreground"
                    onClick={() => removePendingAttachment(attachment.id)}
                  >
                    <X className="h-3.5 w-3.5" />
                    <span className="sr-only">移除附件</span>
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          <div className="mt-3 flex items-center justify-between gap-3 max-md:flex-col max-md:items-stretch">
            <div className="flex items-center gap-2 max-md:flex-wrap">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.md,.csv,.html,.json"
                onChange={handleFileSelect}
              />

              <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={isLoading}>
                <Paperclip className="mr-2 h-4 w-4" />
                上传附件
              </Button>

              <span className="text-xs text-muted-foreground">支持图片与常见办公文档，单个文件不超过 20MB</span>
            </div>

            <Button type="button" onClick={() => handleSendMessage()} disabled={isLoading || (!input.trim() && pendingAttachments.length === 0)}>
              {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
              发送
            </Button>
          </div>

          {composerError ? <p className="mt-2 text-xs text-red-500">{composerError}</p> : null}
        </div>
      </CardFooter>
    </TabsContent>

        <TabsContent value="help" className="mt-0 flex-1 overflow-auto">
          <CardContent className="space-y-4 p-4 text-sm text-muted-foreground">
            <div>
              <h3 className="mb-1 font-medium text-foreground">我可以帮助您处理什么？</h3>
              <ul className="list-disc space-y-1 pl-5">
                <li>解读监测数据、预警信息和防汛值守问题</li>
                <li>识别现场照片中的风险点、设备状态和环境异常</li>
                <li>总结 PDF、Word、Excel、PPT、TXT、Markdown 等附件内容</li>
                <li>基于文档和图片给出处置建议、汇报提纲和行动清单</li>
              </ul>
            </div>

            <div>
              <h3 className="mb-1 font-medium text-foreground">使用建议</h3>
              <ul className="list-disc space-y-1 pl-5">
                <li>提问越具体，回答通常越准确；可直接说明地区、时间和业务场景</li>
                <li>上传附件后，可以继续补一句您的目标，例如“帮我总结重点”或“帮我找风险”</li>
                <li>聊天框已适配常见 Markdown 输出，标题、列表、代码块会自动美化展示</li>
              </ul>
            </div>
          </CardContent>
        </TabsContent>
      </Tabs>
    </Card>
  )
}
