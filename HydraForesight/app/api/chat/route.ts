/*
import { NextResponse } from "next/server"

const API_KEY = "sk-1d195b5799804dc799fc25ddd3069d7f"
const BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"

export async function POST(request: Request) {
  try {
    const { message } = await request.json()
    console.log("[v0] 收到聊天请求:", message)

    const response = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: "deepseek-v3",
        messages: [
          {
            role: "system",
            content: "你是智水先知智能助手...",
          },
          { role: "user", content: message },
        ],
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error("[v0] API错误响应:", errorText)
      throw new Error(`API请求失败: ${response.status}`)
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content || "抱歉，我无法回答这个问题。"
    const reasoning = data.choices?.[0]?.message?.reasoning_content || ""

    return NextResponse.json({ content, reasoning })
  } catch (error) {
    console.error("[v0] Chat API错误:", error)
    return NextResponse.json(
        { error: "处理请求时出错", details: error instanceof Error ? error.message : "未知错误" },
        { status: 500 }
    )
  }
}

export const runtime = "nodejs"
*/

/*
import { NextResponse } from "next/server"

type HistoryMessage = {
  role: "user" | "assistant" | "system"
  content: string
}

type BigModelContentItem =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "file_url"; file_url: { url: string } }

const API_KEY = process.env.BIGMODEL_API_KEY
const MODEL = process.env.BIGMODEL_MODEL || "glm-4.6v"
const BASE_URL = "https://open.bigmodel.cn/api/paas/v4"
const SYSTEM_PROMPT = [
  "你是“智水先知智能助手”，服务于水务、防汛、应急和城市治理场景。",
  "请优先使用简体中文回答，表达清晰、专业、可执行。",
  "当用户上传图片或文件时，请结合附件内容进行分析、总结、提取重点并给出建议。",
  "回答请使用规范 Markdown，合理使用标题、列表、表格或代码块，避免输出难以阅读的原始 Markdown 符号堆叠。",
  "如果附件信息不足以支持明确结论，要主动说明依据和不确定性，不要编造事实。",
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
        textFileSummaries.push(`附件《${file.name}》内容如下：\n${text.slice(0, 20000)}`)
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
      console.warn("聊天历史解析失败:", error)
    }

    return { message, history, files }
  }

  const body = await request.json()
  return {
    message: String(body?.message || "").trim(),
    history: Array.isArray(body?.history) ? body.history : [],
    files: [] as File[],
  }
}

export async function POST(request: Request) {
  try {
    if (!API_KEY) {
      throw new Error("未配置 BIGMODEL_API_KEY")
    }

    const { message, history, files } = await parseRequest(request)

    if (!message && files.length === 0) {
      return NextResponse.json({ error: "请输入问题或上传附件后再发送。" }, { status: 400 })
    }

    const attachmentPayload = await buildAttachmentContent(files)
    const userContent: BigModelContentItem[] = [
      ...attachmentPayload.content,
      ...attachmentPayload.textFileSummaries.map((text) => ({
        type: "text" as const,
        text,
      })),
      {
        type: "text",
        text: message || "请分析我上传的附件，并总结重点结论。",
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
            .filter((item) => item.content?.trim())
            .map((item) => ({
              role: item.role,
              content: item.content.trim(),
            })),
          {
            role: "user",
            content: userContent,
          },
        ],
        thinking: {
          type: "enabled",
        },
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error("智谱聊天接口响应异常:", errorText)
      throw new Error(`智谱接口请求失败(${response.status})`)
    }

    const data = await response.json()
    const assistantMessage = data.choices?.[0]?.message
    const content = normalizeAssistantText(assistantMessage?.content) || "抱歉，我暂时无法回答这个问题。"
    const reasoning = normalizeAssistantText(assistantMessage?.reasoning_content)

    return NextResponse.json({ content, reasoning })
  } catch (error) {
    console.error("聊天接口处理失败:", error)

    return NextResponse.json(
      {
        error: "处理请求时出错",
        details: error instanceof Error ? error.message : "未知错误",
      },
      { status: 500 }
    )
  }
}

export const runtime = "nodejs"
*/

export { POST, runtime } from "./route-impl"
