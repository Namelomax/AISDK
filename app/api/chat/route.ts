import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { streamText, UIMessage, convertToModelMessages, stepCountIs } from 'ai';
import { tool } from 'ai';
import { z } from 'zod';

export const maxDuration = 30;
export const runtime = 'nodejs';

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY!,
});

// ---- Serp Tool ----
const serpTool = tool({
  description: 'Поиск информации через SerpAPI (Google Search)',
  inputSchema: z.object({
    q: z.string().describe('Поисковый запрос'),
  }),
  execute: async ({ q }) => {
    const resp = await fetch(
      `https://serpapi.com/search.json?q=${encodeURIComponent(q)}&api_key=${process.env.SERP_API_KEY}`
    );

    if (!resp.ok) {
      throw new Error(`SerpAPI error: ${resp.status} ${await resp.text()}`);
    }

    const json = await resp.json();

    const results =
      json.organic_results?.slice(0, 3).map((r: any) => ({
        title: r.title,
        link: r.link,
        snippet: r.snippet,
      })) ?? [];

    return { query: q, results };
  },
});

// ---- Weather Tool ----
const weatherTool = tool({
  description: 'Получить погоду для локации',
  inputSchema: z.object({
    location: z.string(),
    units: z.enum(['celsius', 'fahrenheit']).optional(),
  }),
  execute: async ({ location }) => {
    const resp = await fetch(
      `https://api.weatherapi.com/v1/current.json?q=${encodeURIComponent(location)}&key=${process.env.WEATHER_API_KEY}`
    );

    if (!resp.ok) {
      throw new Error(`Weather API error: ${resp.status} ${await resp.text()}`);
    }

    const j = await resp.json();

    return {
      location: j.location.name,
      temperature: `${j.current.temp_c}°C`,
      conditions: j.current.condition.text,
      humidity: `${j.current.humidity}%`,
      windSpeed: `${j.current.wind_kph} kph`,
      lastUpdated: j.current.last_updated,
    };
  },
});

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();
  const modelMessages = convertToModelMessages(messages);

  const result = streamText({
    model: openrouter('nvidia/nemotron-nano-9b-v2:free'),
    messages: modelMessages,
    tools: {
      serp: serpTool,
    },
    stopWhen: stepCountIs(5),
  });

  return result.toUIMessageStreamResponse({
    sendReasoning: true,
  });
}
