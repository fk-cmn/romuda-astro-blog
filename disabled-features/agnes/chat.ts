import type { APIRoute } from 'astro';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    // 1. 接收前端发来的用户消息
    const body = await request.json();
    const userMessage = body.message;

    // 2. 从环境变量读取密钥
    const apiKey = import.meta.env.AGNES_API_KEY;
    // 3. 构建发送给 Agnes API 的数据包
    const payload = {
      model: "agnes-2.0-flash",
      messages: [
        {
          role: "system",
          content: `你现在是博客的专属看板娘。你说话要可爱、富有元气。
          请严格按照以下格式回复：[情绪标签] 回复内容。
          可选的情绪标签只有四个：[happy]（开心）、[sad]（难过）、[angry]（生气）、[idle]（平静）。
          例如：[happy] 哇！今天晚上吃什么好吃的呀？`
        },
        { role: "user", content: userMessage }
      ]
    };

    // 4. 发起网络请求
    const response = await fetch('https://apihub.agnes-ai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();


    if (data.error) {
        throw new Error(data.error.message || "API 内部错误");
    }

    if (!data.choices || data.choices.length === 0) {
        throw new Error("API 返回的数据里没有 choices，请看终端打印的原始数据！");
    }

    const aiReply = data.choices[0].message.content;

    // 5. 将大模型的回复返回给前端
    return new Response(JSON.stringify({ reply: aiReply }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    console.error("后端接口报错:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}
