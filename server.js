require('dotenv').config()

const express = require('express')
const http = require('http')
const WebSocket = require('ws')
const OpenAI = require('openai')
const FormData = require('form-data')

const app = express()
const server = http.createServer(app)

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
})

// ========================
// 📞 Twilio入口
// ========================
app.post('/voice', (req, res) => {
  res.set('Content-Type', 'text/xml')

  res.send(`
<Response>
  <Say>Connected. Real time translation started.</Say>
  <Connect>
    <Stream url="wss://${req.headers.host}/audio" />
  </Connect>
</Response>
  `)
})

// ========================
// 🎙️ WebSocket
// ========================
const wss = new WebSocket.Server({ server })

let audioBuffer = []
let counter = 0

const CHUNK_SIZE = 20   // 调整延迟（越小越快）

wss.on('connection', (ws, req) => {
  if (req.url !== '/audio') return

  console.log('🎙️ Audio connected')

  ws.on('message', async (msg) => {
    try {
      const data = JSON.parse(msg)

      if (data.event === 'media') {
        audioBuffer.push(data.media.payload)
        counter++

        if (counter >= CHUNK_SIZE) {
          const chunkBase64 = audioBuffer.join('')
          audioBuffer = []
          counter = 0

          const audio = Buffer.from(chunkBase64, 'base64')

          // ========================
          // 🎧 1. 语音识别（真实）
          // ========================
          let transcript = ""

          try {
            const transcription = await openai.audio.transcriptions.create({
              file: audio,
              model: "gpt-4o-mini-transcribe"
            })

            transcript = transcription.text || ""
          } catch (e) {
            console.log("识别失败，跳过")
            return
          }

          if (!transcript) return

          console.log("🎧 Heard:", transcript)

          // ========================
          // 🌐 2. 翻译
          // ========================
          const tr = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
              {
                role: "system",
                content: "把内容翻译成简短中文（10字左右）"
              },
              {
                role: "user",
                content: transcript
              }
            ]
          })

          const zh = tr.choices[0].message.content
          console.log("🌐 翻译:", zh)

          // ========================
          // 🔊 3. TTS
          // ========================
          const speech = await openai.audio.speech.create({
            model: "gpt-4o-mini-tts",
            voice: "alloy",
            input: zh
          })

          const out = Buffer.from(await speech.arrayBuffer()).toString('base64')

          // ========================
          // 📡 4. 回传音频
          // ========================
          ws.send(JSON.stringify({
            event: "media",
            media: {
              payload: out
            }
          }))
        }
      }

    } catch (err) {
      console.error("Error:", err.message)
    }
  })
})

// ========================
// 🚀 启动
// ========================
const PORT = process.env.PORT || 8080

server.listen(PORT, () => {
  console.log("🚀 Server running on", PORT)
})