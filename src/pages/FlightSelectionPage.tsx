import React, { useState, useEffect } from 'react';
import { ArrowLeft, ExternalLink, Plane, Search, Loader2, Train, Ticket, Calendar, Clock, MapPin, AlertCircle } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { GoogleGenAI, Type } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

interface AIOption {
  airline: string;
  flightNumber: string;
  departureTime: string;
  arrivalTime: string;
  duration: string;
  price: string;
  stops: string;
  bookingUrl: string;
  type: 'flight' | 'train';
}

const FlightSelectionPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const language = localStorage.getItem('app_language') || 'zh';

  const [origin, setOrigin] = useState(location.state?.origin || '');
  const [destination, setDestination] = useState(location.state?.destination || '');
  const [startDate, setStartDate] = useState(location.state?.startDate || '');
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const [options, setOptions] = useState<AIOption[]>([]);
  const [error, setError] = useState<string | null>(null);

  const loadingTextsZh = [
    '⚡ 正在通过 Gemini Flash 极速检索全网航线...',
    '🔥 正在通过 Google Search 并发抓取实时票价...',
    '✨ 正在为您深度搜集 15+ 航班/高铁快线...',
    '🚀 正在解析时刻表并整理最终直达入口...'
  ];
  
  const loadingTextsEn = [
    '⚡ Searching global routes via Gemini Flash...',
    '🔥 Scraping real-time prices via Google Search...',
    '✨ Fetching 15+ flight/train options...',
    '🚀 Parsing schedules and formatting...'
  ];

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (loading) {
      setLoadingStep(0);
      interval = setInterval(() => {
        setLoadingStep((prev) => (prev < 3 ? prev + 1 : prev));
      }, 1500);
    }
    return () => clearInterval(interval);
  }, [loading]);

  const fetchFlights = async () => {
    if (!origin || !destination || origin === 'Custom' || destination === 'Custom') {
      setError(language === 'zh' ? '请输入有效的出发地和目的地' : 'Please enter valid origin and destination');
      return;
    }
    setLoading(true);
    setError(null);
    setOptions([]);

    try {
      const dateContext = startDate ? `on ${startDate}` : 'for tomorrow or next week (whichever is available)';
      const prompt = `Use the googleSearch tool to explicitly find and comprehensively list AT LEAST 15 real, actual upcoming flight or high-speed train schedules from ${origin} to ${destination} ${dateContext}. You must perform a deep search to gather a high volume of diverse options across different airlines/operators, departure times (morning, afternoon, evening), and realistic prices. Return the data exactly adhering to the requested JSON Array format. Do not return fewer than 12 options.`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.1-pro-preview',
        contents: prompt,
        // @ts-ignore
        tools: [{ googleSearch: {} }],
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                airline: { type: Type.STRING, description: 'Airline or Train Operator Name' },
                flightNumber: { type: Type.STRING },
                departureTime: { type: Type.STRING, description: 'E.g. 08:30 AM' },
                arrivalTime: { type: Type.STRING, description: 'E.g. 11:45 AM' },
                duration: { type: Type.STRING, description: 'E.g. 3h 15m' },
                price: { type: Type.STRING, description: 'Price roughly in local currency (e.g. $150 or ¥800)' },
                stops: { type: Type.STRING, description: 'Direct, 1 Stop, etc.' },
                bookingUrl: { type: Type.STRING, description: 'A realistic URL to search/book this flight (can be just https://www.google.com/travel/flights?q=...)' },
                type: { type: Type.STRING, description: "Either 'flight' or 'train'" }
              },
              required: ['airline', 'flightNumber', 'departureTime', 'arrivalTime', 'duration', 'price', 'stops', 'bookingUrl', 'type']
            }
          }
        }
      });

      const data = JSON.parse(response.text.trim()) as AIOption[];
      setOptions(data);
    } catch (err: any) {
      console.error('Error fetching flights:', err);
      setError(language === 'zh' ? 'AI 检索失败，可能是由于网络波动或搜索限制。' : 'AI search failed, possibly due to rate limits or network issues.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (origin && destination && origin !== 'Custom' && destination !== 'Custom') {
      fetchFlights();
    }
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col font-sans selection:bg-blue-100 selection:text-blue-900">
      
      {/* Header section */}
      <div className="bg-white border-b border-gray-100 py-6 px-6 md:px-12 sticky top-0 z-10 shadow-sm">
        <div className="max-w-5xl mx-auto">
          <button 
            onClick={() => navigate(-1)} 
            className="flex items-center gap-2 text-gray-500 hover:text-gray-900 transition-colors mb-4 group w-fit"
          >
            <ArrowLeft size={20} className="group-hover:-translate-x-1 transition-transform" />
            {language === 'zh' ? '返回行程' : 'Back to Planner'}
          </button>
          
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-blue-100 rounded-2xl shrink-0">
                <Search className="text-blue-600" size={28} />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900 tracking-tight">
                  {language === 'zh' ? 'AI 全网实时航线检索' : 'AI Global Flight Search'}
                </h1>
                <p className="text-gray-500 text-sm mt-1">
                  {language === 'zh' ? '基于 Gemini 与 Google Search 获取最新行程班次' : 'Powered by Gemini & Google Search for real-time schedules'}
                </p>
              </div>
            </div>

            <div className="flex bg-gray-50 p-2 rounded-2xl border border-gray-100 flex-wrap sm:flex-nowrap">
              <div className="flex items-center gap-2 px-3 py-2">
                <MapPin size={16} className="text-gray-400" />
                <input 
                  type="text" 
                  value={origin}
                  onChange={e => setOrigin(e.target.value)}
                  placeholder={language === 'zh' ? "出发地" : "Origin"}
                  className="bg-transparent border-none outline-none w-24 md:w-32 font-bold text-gray-900 placeholder:text-gray-300"
                />
              </div>
              <div className="px-2 py-2 flex items-center justify-center text-gray-300">
                <Plane size={16} />
              </div>
              <div className="flex items-center gap-2 px-3 py-2">
                <MapPin size={16} className="text-gray-400" />
                <input 
                  type="text" 
                  value={destination}
                  onChange={e => setDestination(e.target.value)}
                  placeholder={language === 'zh' ? "目的地" : "Destination"}
                  className="bg-transparent border-none outline-none w-24 md:w-32 font-bold text-gray-900 placeholder:text-gray-300"
                />
              </div>
              <div className="flex items-center gap-2 px-3 py-2 border-l border-gray-200">
                <Calendar size={16} className="text-gray-400" />
                <input 
                  type="date" 
                  value={startDate}
                  onChange={e => setStartDate(e.target.value)}
                  className="bg-transparent border-none outline-none w-32 font-bold text-gray-900 placeholder:text-gray-300 text-sm"
                />
              </div>
              <button 
                onClick={fetchFlights}
                disabled={loading}
                className="ml-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white px-5 py-2 rounded-xl font-bold transition-colors"
              >
                {language === 'zh' ? '检索' : 'Search'}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 max-w-5xl mx-auto w-full p-6 md:p-12">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-64 bg-white rounded-3xl border border-gray-100 shadow-sm gap-4 relative overflow-hidden">
            <div className="absolute inset-0 bg-blue-50/50 animate-pulse pointer-events-none"></div>
            <Loader2 className="animate-spin text-blue-500 relative z-10" size={40} />
            <p className="text-blue-600 font-bold tracking-tight relative z-10 text-lg">
              {language === 'zh' ? loadingTextsZh[loadingStep] : loadingTextsEn[loadingStep]}
            </p>
            <p className="text-gray-400 text-xs mt-2 text-center max-w-sm relative z-10">
              {language === 'zh' ? '基于 Gemini 3.1 极速模型与 Search Grounding 实时构建，通常只需几秒钟即可返回十余条结果。' : 'Powered by Gemini 3.1 Flash and Google Search Grounding for lightning-fast results in seconds.'}
            </p>
          </div>
        ) : error ? (
           <div className="flex flex-col items-center justify-center h-64 bg-rose-50 rounded-3xl border border-rose-100 gap-4 text-rose-600">
            <AlertCircle size={40} />
            <p className="font-bold">{error}</p>
          </div>
        ) : options.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {options.map((opt, idx) => (
              <div key={idx} className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm hover:border-blue-200 hover:shadow-md transition-all relative overflow-hidden group">
                <div className="absolute -right-6 -bottom-6 opacity-[0.03] pointer-events-none transform group-hover:scale-110 transition-transform duration-500">
                   {opt.type === 'train' ? <Train size={160} /> : <Plane size={160} />}
                </div>

                <div className="flex items-start justify-between mb-6">
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                       <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-gray-100 text-gray-600 text-[10px] font-bold uppercase tracking-wider">
                         {opt.type === 'train' ? <Train size={12}/> : <Plane size={12}/>}
                         {opt.type === 'train' ? (language === 'zh' ? '高铁/动车' : 'Train') : (language === 'zh' ? '航班' : 'Flight')}
                       </span>
                       <span className="text-xs font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded-md border border-blue-100">
                         {opt.stops}
                       </span>
                    </div>
                    <h3 className="font-bold text-gray-900 text-xl">{opt.airline}</h3>
                    <p className="text-sm text-gray-500 mt-1">{opt.flightNumber}</p>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-black text-gray-900">{opt.price}</div>
                  </div>
                </div>

                <div className="flex items-center justify-between bg-gray-50 p-4 rounded-2xl mb-6">
                  <div className="text-center">
                    <div className="text-xl font-bold text-gray-900 font-mono tracking-tight">{opt.departureTime}</div>
                    <div className="text-xs text-gray-500 mt-1 font-medium">{origin}</div>
                  </div>
                  
                  <div className="flex-1 px-4 flex flex-col items-center">
                    <div className="text-[10px] text-gray-400 font-bold mb-2 flex items-center gap-1"><Clock size={12}/> {opt.duration}</div>
                    <div className="w-full relative h-px bg-gray-300">
                      <div className="absolute inset-0 bg-blue-500 w-0 group-hover:w-full transition-all duration-1000 ease-in-out"></div>
                      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-gray-50 px-2 text-gray-400 group-hover:text-blue-500 transition-colors">
                        {opt.type === 'train' ? <Train size={16} /> : <Plane size={16} />}
                      </div>
                    </div>
                  </div>

                  <div className="text-center">
                    <div className="text-xl font-bold text-gray-900 font-mono tracking-tight">{opt.arrivalTime}</div>
                    <div className="text-xs text-gray-500 mt-1 font-medium">{destination}</div>
                  </div>
                </div>

                <a 
                  href={
                    opt.type === 'flight' 
                      ? `https://www.google.com/travel/flights?q=${encodeURIComponent(`Flights from ${origin} to ${destination} ${startDate ? 'on ' + startDate : ''} ${opt.airline} ${opt.flightNumber}`)}`
                      : `https://www.google.com/search?q=${encodeURIComponent(`${opt.airline} ${opt.flightNumber} train from ${origin} to ${destination} ${startDate ? 'on ' + startDate : ''}`)}`
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full py-3.5 bg-gray-900 hover:bg-blue-600 text-white rounded-xl font-bold flex items-center justify-center gap-2 transition-colors"
                >
                  {language === 'zh' ? '前往查看/预订' : 'View / Book'}
                  <ExternalLink size={16} />
                </a>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-64 bg-white rounded-3xl border border-gray-100 shadow-sm gap-4 text-center p-6">
            <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mb-2">
              <Search className="text-blue-500" size={32} />
            </div>
            <h3 className="text-xl font-bold text-gray-900">
              {language === 'zh' ? '输入地点，开启全网实时搜索' : 'Enter locations to begin real-time search'}
            </h3>
            <p className="text-gray-500">
              {language === 'zh' ? '利用大模型结合 Google 搜索能力，直接检索最新的行程班次与票价。' : 'Using LLM & Google Search to fetch the latest flights and prices.'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default FlightSelectionPage;
