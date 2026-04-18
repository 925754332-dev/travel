import { GoogleGenAI, Type } from '@google/genai';
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
async function test() {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.1-pro-preview",
      contents: "Find 3 real flight options from New York to London for next week. Return prices and times.",
      // @ts-ignore
      tools: [{ googleSearch: {} }],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              airline: { type: Type.STRING },
              price: { type: Type.STRING }
            }
          }
        }
      }
    });
    console.log("SUCCESS:");
    console.log(response.text);
  } catch (e) {
    console.error("ERROR:", e.message);
  }
}
test();
