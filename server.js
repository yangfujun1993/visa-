require('dotenv').config()

const express = require('express')
const bodyParser = require('body-parser')
const OpenAI = require('openai')
const twilio = require('twilio')

const app = express()
app.use(bodyParser.urlencoded({ extended: false }))
app.use(express.json())
app.use(express.static('public'))

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
})

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
)

// 内存数据库
let calls = []
let lastText = ""

// ========================
// 📞 网页拨号
// ========================
app.post('/call', async (req, res) => {
  const { to } = req.body

  try {
    const call = await client.calls.create({
      url: `${process.env.BASE_URL}/voice`,
      to: to,
      from: process.env.TWILIO_PHONE
    })

    calls.push({
      to,
      time: new Date().toLocaleString(),
      status: "called"
    })

    res.json({ success: true })
  } catch (err) {
    res.json({ success: false, error: err.message })
  }
})

// ========================
// 📞 接通
// ========================
app.post('/voice', (req, res) => {
  res.set('Content-Type', 'text/xml')

  res.send(`
<Response>
  <Say voice="Polly.Joanna" rate="85%">双向翻译已开启，请开始说话</Say>
  <Gather input="speech" action="/process" method="POST" speechTimeout="auto"/>
</Response>
  `)
})

// ========================
// 🧠 双向翻译
// ========================
app.post('/process', async (req, res) => {
  res.set('Content-Type', 'text/xml')

  const speech = req.body.SpeechResult || ""

  if (!speech || speech === lastText) {
    return res.send(`<Response><Gather input="speech" action="/process"/></Response>`)
  }

  lastText = speech

  const isChinese = /[\u4e00-\u9fa5]/.test(speech)

  const prompt = isChinese
    ? "把下面中文翻译成自然流畅的英文电话对话（简短）"
    : "把下面英文翻译成自然流畅的中文电话对话（简短）"

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: speech }
      ]
    })

    const result = completion.choices[0].message.content

    res.send(`
<Response>
  <Say voice="Polly.Joanna" rate="85%">${result}</Say>
  <Gather input="speech" action="/process" method="POST"/>
</Response>
    `)

  } catch (err) {
    res.send(`<Response><Say>系统错误，请重试</Say></Response>`)
  }
})

// ========================
// 📊 后台
// ========================
app.get('/admin', (req, res) => {
  res.send(`
    <h2>📊 通话记录</h2>
    <ul>
      ${calls.map(c => `<li>${c.time} - ${c.to}</li>`).join('')}
    </ul>
  `)
})

// ========================
const PORT = process.env.PORT || 8080

app.listen(PORT, () => {
  console.log("🚀 Server running")
})