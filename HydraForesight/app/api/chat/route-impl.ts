import { NextResponse } from "next/server"

type HistoryMessage = {
  role: "user" | "assistant" | "system"
  content: string
}

type BigModelContentItem =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "file_url"; file_url: { url: string } }

type AttachmentPayload = {
  kind: "image" | "document"
  name: string
  mimeType?: string
  url?: string
  textContent?: string
}

const API_KEY = process.env.BIGMODEL_API_KEY
const MODEL = process.env.BIGMODEL_MODEL || "glm-4.6v"
const BASE_URL = "https://open.bigmodel.cn/api/paas/v4"
const SYSTEM_PROMPT = [
  "You are Zhi Shui Xian Zhi AI Assistant for water management, flood control, emergency response, and city operations.",
  "Reply in Simplified Chinese with clear, professional, and actionable answers.",
  "When the user uploads images or files, analyze them together with the text question and summarize key findings.",
  "Format the answer as clean Markdown with readable headings, lists, tables, or code blocks when helpful.",
  "If the evidence is incomplete, explicitly state uncertainty instead of making up facts.",
].join(" ")

function isTextLikeFile(file: File) {
  if (file.type.startsWith("text/")) {
    return true
  }

  const lowerName = file.name.toLowerCase()
  return [".txt", ".md", ".csv", ".json", ".html", ".xml"].some((extension) => lowerName.endsWith(extension))
}

function getMimeType(file: File) {
  if (file.type) {
    return file.type
  }

  const lowerName = file.name.toLowerCase()

  if (lowerName.endsWith(".md")) return "text/markdown"
  if (lowerName.endsWith(".csv")) return "text/csv"
  if (lowerName.endsWith(".json")) return "application/json"
  if (lowerName.endsWith(".pdf")) return "application/pdf"
  if (lowerName.endsWith(".doc")) return "application/msword"
  if (lowerName.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  if (lowerName.endsWith(".xls")) return "application/vnd.ms-excel"
  if (lowerName.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  if (lowerName.endsWith(".ppt")) return "application/vnd.ms-powerpoint"
  if (lowerName.endsWith(".pptx")) return "application/vnd.openxmlformats-officedocument.presentationml.presentation"

  return "application/octet-stream"
}

function normalizeAssistantText(content: unknown) {
  if (typeof content === "string") {
    return content
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") {
          return item
        }

        if (item && typeof item === "object" && "text" in item && typeof item.text === "string") {
          return item.text
        }

        return ""
      })
      .filter(Boolean)
      .join("\n")
  }

  return ""
}

async function fileToDataUrl(file: File) {
  const arrayBuffer = await file.arrayBuffer()
  const base64 = Buffer.from(arrayBuffer).toString("base64")
  return `data:${getMimeType(file)};base64,${base64}`
}

async function buildAttachmentContent(files: File[]) {
  const content: BigModelContentItem[] = []
  const textFileSummaries: string[] = []

  for (const file of files) {
    if (file.type.startsWith("image/")) {
      content.push({
        type: "image_url",
        image_url: {
          url: await fileToDataUrl(file),
        },
      })
      continue
    }

    if (isTextLikeFile(file)) {
      const text = (await file.text()).trim()

      if (text) {
        textFileSummaries.push(`Attachment "${file.name}" content:\n${text.slice(0, 20000)}`)
      }

      continue
    }

    content.push({
      type: "file_url",
      file_url: {
        url: await fileToDataUrl(file),
      },
    })
  }

  return { content, textFileSummaries }
}

function buildUploadedAttachmentContent(attachments: AttachmentPayload[]) {
  const content: BigModelContentItem[] = []
  const textFileSummaries: string[] = []

  for (const attachment of attachments) {
    if (attachment.textContent?.trim()) {
      textFileSummaries.push(`Attachment "${attachment.name}" content:\n${attachment.textContent.trim().slice(0, 20000)}`)
    }

    if (!attachment.url) {
      continue
    }

    if (attachment.kind === "image") {
      content.push({
        type: "image_url",
        image_url: {
          url: attachment.url,
        },
      })
      continue
    }

    content.push({
      type: "file_url",
      file_url: {
        url: attachment.url,
      },
    })
  }

  return { content, textFileSummaries }
}

async function parseRequest(request: Request) {
  const contentType = request.headers.get("content-type") || ""

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData()
    const message = String(formData.get("message") || "").trim()
    const historyRaw = String(formData.get("history") || "[]")
    const files = formData
      .getAll("files")
      .filter((item): item is File => item instanceof File && item.size > 0)

    let history: HistoryMessage[] = []

    try {
      const parsed = JSON.parse(historyRaw)
      if (Array.isArray(parsed)) {
        history = parsed.filter(
          (item): item is HistoryMessage =>
            item &&
            typeof item === "object" &&
            typeof item.role === "string" &&
            typeof item.content === "string"
        )
      }
    } catch (error) {
      console.warn("Failed to parse chat history:", error)
    }

    return { message, history, files }
  }

  const body = await request.json()
  return {
    message: String(body?.message || "").trim(),
    history: Array.isArray(body?.history) ? (body.history as HistoryMessage[]) : [],
    files: [] as File[],
    attachments: Array.isArray(body?.attachments) ? (body.attachments as AttachmentPayload[]) : [],
  }
}

function encodeSSE(event: string, payload: Record<string, unknown>) {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`
}

function extractReasoningText(value: unknown) {
  if (value && typeof value === "object" && "reasoning_content" in value) {
    return normalizeAssistantText(value.reasoning_content)
  }

  return ""
}

function extractSSEDataBlocks(buffer: string) {
  const blocks = buffer.split(/\r?\n\r?\n/)
  const remainder = blocks.pop() ?? ""

  return {
    blocks,
    remainder,
  }
}

function parseSSEData(block: string) {
  const dataLines = block
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())

  return dataLines.length > 0 ? dataLines.join("\n") : null
}

function createStreamingResponse(upstream: Response) {
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()

  return new Response(
    new ReadableStream({
      async start(controller) {
        const reader = upstream.body?.getReader()

        if (!reader) {
          controller.enqueue(encoder.encode(encodeSSE("error", { message: "Streaming upstream is unavailable." })))
          controller.close()
          return
        }

        let buffer = ""
        let assistantContent = ""
        let reasoningContent = ""
        let completed = false

        const emitDone = (finishReason = "stop") => {
          if (completed) {
            return
          }

          completed = true
          controller.enqueue(
            encoder.encode(
              encodeSSE("done", {
                content: assistantContent,
                reasoning: reasoningContent,
                finishReason,
              })
            )
          )
        }

        const consumeData = (data: string | null) => {
          if (!data) {
            return
          }

          if (data === "[DONE]") {
            emitDone()
            return
          }

          let payload: any

          try {
            payload = JSON.parse(data)
          } catch {
            return
          }

          const choice = payload?.choices?.[0]
          if (!choice) {
            return
          }

          const delta = choice.delta ?? choice.message ?? {}
          const contentChunk = normalizeAssistantText(delta?.content)
          const reasoningChunk = extractReasoningText(delta) || normalizeAssistantText(choice?.delta?.reasoning_content)

          if (contentChunk) {
            assistantContent += contentChunk
            controller.enqueue(encoder.encode(encodeSSE("token", { content: contentChunk })))
          }

          if (reasoningChunk) {
            reasoningContent += reasoningChunk
            controller.enqueue(encoder.encode(encodeSSE("reasoning", { content: reasoningChunk })))
          }

          if (choice.finish_reason) {
            emitDone(String(choice.finish_reason))
          }
        }

        try {
          while (true) {
            const { done, value } = await reader.read()

            buffer += decoder.decode(value || new Uint8Array(), { stream: !done })

            const parsed = extractSSEDataBlocks(buffer)
            buffer = parsed.remainder

            parsed.blocks.forEach((block) => consumeData(parseSSEData(block)))

            if (done) {
              break
            }
          }

          if (buffer.trim()) {
            consumeData(parseSSEData(`${buffer}\n\n`))
          }

          emitDone()
          controller.close()
        } catch (error) {
          controller.enqueue(
            encoder.encode(
              encodeSSE("error", {
                message: error instanceof Error ? error.message : "Streaming response was interrupted.",
              })
            )
          )
          controller.close()
        }
      },
    }),
    {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    }
  )
}

export async function POST(request: Request) {
  try {
    if (!API_KEY) {
      throw new Error("BIGMODEL_API_KEY is not configured")
    }

    const { message, history, files, attachments = [] } = await parseRequest(request)

    if (!message && files.length === 0 && attachments.length === 0) {
      return NextResponse.json({ error: "Please enter a message or upload files first." }, { status: 400 })
    }

    const fileAttachmentPayload = await buildAttachmentContent(files)
    const uploadedAttachmentPayload = buildUploadedAttachmentContent(attachments)
    const userContent: BigModelContentItem[] = [
      ...fileAttachmentPayload.content,
      ...uploadedAttachmentPayload.content,
      ...fileAttachmentPayload.textFileSummaries.map((text) => ({
        type: "text" as const,
        text,
      })),
      ...uploadedAttachmentPayload.textFileSummaries.map((text) => ({
        type: "text" as const,
        text,
      })),
      {
        type: "text",
        text: message || "Please analyze my uploaded files and summarize the key points.",
      },
    ]

    const response = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          ...history
            .filter((item: HistoryMessage) => item.content.trim())
            .map((item: HistoryMessage) => ({
              role: item.role,
              content: item.content.trim(),
            })),
          {
            role: "user",
            content: userContent,
          },
        ],
        stream: true,
        thinking: {
          type: "enabled",
        },
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error("BigModel chat API error:", errorText)
      throw new Error(`BigModel request failed (${response.status})`)
    }

    return createStreamingResponse(response)
  } catch (error) {
    console.error("Chat route failed:", error)

    return NextResponse.json(
      {
        error: "Request failed",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    )
  }
}

export const runtime = "nodejs"
