import { useState, useEffect } from 'react';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import { ArrowLeft, MapPin, Calendar, Plane, Hotel, Map, Clock, Sparkles, Loader2, Navigation, Info, Train, Camera, Globe, Search, ExternalLink, PlaneTakeoff, PlaneLanding, Ticket, CheckCircle2, Circle, Save, Check, Utensils, MessageSquare, X, Send, Bus, Car, Ship, Footprints, Receipt, Users, ChevronDown, ChevronUp, ArrowUp, ChevronsUpDown, ChevronsDownUp, Share, Plus, Upload } from 'lucide-react';
import { GoogleGenAI, Type } from '@google/genai';
import GlobalAuth from '../components/GlobalAuth';
import { auth, db, handleFirestoreError, OperationType } from '../firebase';
import { doc, collection, setDoc, updateDoc, query, orderBy, limit, getDocs, onSnapshot } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import * as XLSX from 'xlsx';

// Initialize Gemini API
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Types for our AI response
interface TimelineEvent {
  time: string;
  type: 'activity' | 'transportation' | 'dining';
  title: string;
  description: string;
  searchQuery: string;
  officialWebsite: string;
  wikipediaTitle: string;
  googleMapsUrl: string;
}

interface Accommodation {
  name: string;
  description: string;
  price: string;
  stars: number;
  bookingQuery: string;
}

interface DayPlan {
  dayNumber: number;
  theme: string;
  accommodation: Accommodation;
  events: TimelineEvent[];
}

interface FlightOption {
  id: string;
  type: 'flight' | 'train';
  tag: string;
  airline: string;
  outboundDeparture: string;
  outboundArrival: string;
  outboundCrossDay: string;
  outboundTransit: string;
  returnDeparture: string;
  returnArrival: string;
  returnCrossDay: string;
  returnTransit: string;
  price: string;
  bookingQuery: string;
}

interface TravelPlan {
  flightOptions: FlightOption[];
  days: DayPlan[];
  parsedOrigin?: string;
  parsedDestination?: string;
  aiMessage?: string;
}

const daysSchema = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      dayNumber: { type: Type.INTEGER },
      theme: { type: Type.STRING },
      accommodation: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          description: { type: Type.STRING },
          price: { type: Type.STRING, description: "Estimated price per night with currency symbol" },
          stars: { type: Type.NUMBER, description: "Hotel star rating, 1-5" },
          bookingQuery: { type: Type.STRING, description: "Search query for Google Hotels, e.g., 'Hotels in Tokyo Shinjuku'" }
        },
        required: ["name", "description", "price", "stars", "bookingQuery"]
      },
      events: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            time: { type: Type.STRING, description: "Time range for the event, e.g., '09:00 AM - 11:30 AM' or '14:00 - 16:00'" },
            type: { type: Type.STRING, description: "Must be exactly 'activity', 'transportation', or 'dining'" },
            title: { type: Type.STRING },
            description: { type: Type.STRING },
            searchQuery: { type: Type.STRING },
            officialWebsite: { type: Type.STRING },
            wikipediaTitle: { type: Type.STRING },
            googleMapsUrl: { type: Type.STRING, description: "Google Maps directions URL for transportation, or place URL for activities" }
          },
          required: ["time", "type", "title", "description", "searchQuery", "officialWebsite", "wikipediaTitle", "googleMapsUrl"]
        }
      }
    },
    required: ["dayNumber", "theme", "accommodation", "events"]
  }
};

const flightOptionsSchema = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      id: { type: Type.STRING, description: "A unique string ID like 'flight-1'" },
      type: { type: Type.STRING, enum: ["flight", "train"], description: "Whether this is a flight or a high-speed train (HSR)" },
      tag: { type: Type.STRING, description: "e.g., 最便宜 (Cheapest), 最快 (Fastest), 性价比最高 (Best Value)" },
      airline: { type: Type.STRING, description: "e.g., ANA / Japan Airlines or China Railway (中国铁路)" },
      outboundDeparture: { type: Type.STRING, description: "e.g., 10:00 AM" },
      outboundArrival: { type: Type.STRING, description: "e.g., 02:00 PM" },
      outboundCrossDay: { type: Type.STRING, description: "e.g., '+1' if it arrives the next day, otherwise empty string ''" },
      outboundTransit: { type: Type.STRING, description: "e.g., 'Direct' or '1 Stop (ICN, 2h 30m)'" },
      returnDeparture: { type: Type.STRING, description: "e.g., 04:00 PM" },
      returnArrival: { type: Type.STRING, description: "e.g., 08:00 PM" },
      returnCrossDay: { type: Type.STRING, description: "e.g., '+1' if it arrives the next day, otherwise empty string ''" },
      returnTransit: { type: Type.STRING, description: "e.g., 'Direct' or '1 Stop (ICN, 2h 30m)'" },
      price: { type: Type.STRING, description: "Estimated price with currency symbol" },
      bookingQuery: { type: Type.STRING, description: "e.g., Flights from New York to Tokyo or Trains from Beijing to Shanghai" }
    },
    required: ["id", "type", "tag", "airline", "outboundDeparture", "outboundArrival", "outboundCrossDay", "outboundTransit", "returnDeparture", "returnArrival", "returnCrossDay", "returnTransit", "price", "bookingQuery"]
  }
};

const planSchema = {
  type: Type.OBJECT,
  properties: {
    flightOptions: flightOptionsSchema,
    days: daysSchema,
    parsedOrigin: { type: Type.STRING, description: "The origin city detected from context, e.g. 'Beijing'" },
    parsedDestination: { type: Type.STRING, description: "The destination city detected from context, e.g. 'Tokyo'" },
    aiMessage: { type: Type.STRING, description: "Optional dynamic message from AI explaining the changes." }
  },
  required: ["flightOptions", "days", "parsedOrigin", "parsedDestination"]
};

const translations = {
  zh: {
    back: '返回首页',
    myPlans: '我的行程',
    title: 'AI 智能旅行规划',
    subtitle: '让 AI 在几秒钟内为您定制完美行程。',
    origin: '出发地',
    originPlaceholder: '例如：北京',
    destination: '目的地',
    destinationPlaceholder: '例如：东京',
    peopleCount: '出行人数',
    days: '游玩天数',
    daysPlaceholder: '例如：5',
    startDate: '出发日期（可选）',
    endDate: '返程日期（可选）',
    requirements: '其他要求（可选）',
    requirementsPlaceholder: '例如：我偏好素食，想多逛逛博物馆，希望乘坐火车旅行。',
    generate: '生成行程',
    generating: '正在为您精心规划...',
    errorEmpty: '请填写出发地、目的地和天数，或直接上传文档/填写要求。',
    errorFail: '生成计划失败，请重试。',
    dayPrefix: '第',
    daySuffix: '天',
    dayOf: '天，共',
    accommodation: '住宿安排',
    itinerary: '每日行程',
    activity: '活动',
    transportation: '交通',
    dining: '餐饮',
    officialSite: '访问官网',
    searchGoogle: '在 Google 搜索',
    flightTitle: '🚆 交通选择 (航班/高铁)',
    outbound: '去程',
    returnFlight: '返程',
    returnTrain: '返程',
    searchFlights: '去 Google 搜索预订',
    selectFlight: '选择',
    selected: '已选择',
    savePlan: '保存行程',
    savedSuccess: '行程已成功保存到本地！',
    replan: '根据此交通重新规划行程',
    replanning: '正在重新规划...',
    departure: '起飞/出发',
    trainDeparture: '出发',
    arrival: '降落/到达',
    trainArrival: '到达',
    chatTitle: '调整行程',
    chatPlaceholder: '告诉我想怎么改，比如"把第一天的晚餐换成吃烤鸭"...',
    chatSend: '发送',
    chatEmpty: '有什么想调整的吗？随时告诉我！',
    viewOnGoogleMaps: '在 Google Maps 查看'
  },
  en: {
    back: 'Back to Home',
    myPlans: 'My Itineraries',
    title: 'AI Travel Planner',
    subtitle: 'Let AI craft your perfect itinerary in seconds.',
    origin: 'Origin',
    originPlaceholder: 'e.g. New York',
    destination: 'Destination',
    destinationPlaceholder: 'e.g. Tokyo',
    peopleCount: 'People',
    days: 'Duration (Days)',
    daysPlaceholder: 'e.g. 5',
    startDate: 'Start Date (Optional)',
    endDate: 'End Date (Optional)',
    requirements: 'Other Requirements (Optional)',
    requirementsPlaceholder: 'e.g. I prefer vegetarian food, want to visit museums, and travel by train.',
    generate: 'Generate Plan',
    generating: 'Crafting your itinerary...',
    errorEmpty: 'Please fill in origin, destination, and days, or provide context in the requirements.',
    errorFail: 'Failed to generate plan. Please try again.',
    dayPrefix: 'Day',
    daySuffix: '',
    dayOf: 'of',
    accommodation: 'Accommodation',
    itinerary: 'Daily Itinerary',
    activity: 'Activity',
    transportation: 'Transport',
    dining: 'Dining',
    officialSite: 'Official Website',
    searchGoogle: 'Search on Google',
    flightTitle: '🚆 Transport Options (Flight/HSR)',
    outbound: 'Outbound',
    returnFlight: 'Return',
    returnTrain: 'Return',
    searchFlights: 'Search to Book',
    selectFlight: 'Select',
    selected: 'Selected',
    savePlan: 'Save Itinerary',
    savedSuccess: 'Itinerary saved successfully!',
    replan: 'Re-plan Itinerary for this Transport',
    replanning: 'Re-planning...',
    departure: 'Departs',
    trainDeparture: 'Departs',
    arrival: 'Arrives',
    trainArrival: 'Arrives',
    chatTitle: 'Modify Itinerary',
    chatPlaceholder: 'Tell me what to change, e.g., "Change day 1 dinner to pizza"...',
    chatSend: 'Send',
    chatEmpty: 'Want to make any changes? Let me know!',
    viewOnGoogleMaps: 'View on Google Maps'
  }
};

const getTransportIcon = (title: string, desc: string) => {
  const text = (title + ' ' + desc).toLowerCase();
  if (text.includes('✈️') || text.includes('flight') || text.includes('plane') || text.includes('airport') || text.includes('飞机') || text.includes('航班') || text.includes('机场')) return Plane;
  if (text.includes('bus') || text.includes('coach') || text.includes('巴士') || text.includes('公交') || text.includes('大巴')) return Bus;
  if (text.includes('taxi') || text.includes('car') || text.includes('drive') || text.includes('uber') || text.includes('出租车') || text.includes('打车') || text.includes('自驾') || text.includes('汽车')) return Car;
  if (text.includes('boat') || text.includes('ship') || text.includes('ferry') || text.includes('cruise') || text.includes('船') || text.includes('渡轮') || text.includes('游轮')) return Ship;
  if (text.includes('walk') || text.includes('foot') || text.includes('hike') || text.includes('步行') || text.includes('走路') || text.includes('徒步')) return Footprints;
  if (text.includes('metro') || text.includes('subway') || text.includes('train') || text.includes('rail') || text.includes('地铁') || text.includes('火车') || text.includes('铁路') || text.includes('轻轨')) return Train;
  return Navigation; // Default transport icon
};

// Component to fetch and display real Wikipedia images
function AttractionImage({ wikipediaTitle, fallbackKeyword, alt }: { wikipediaTitle: string, fallbackKeyword: string, alt: string }) {
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!wikipediaTitle) {
      setError(true);
      return;
    }
    
    // Fetch image from Wikipedia REST API
    fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(wikipediaTitle)}`)
      .then(res => res.json())
      .then(data => {
        if (data.thumbnail && data.thumbnail.source) {
          setImgUrl(data.thumbnail.source);
        } else {
          setError(true);
        }
      })
      .catch(() => setError(true));
  }, [wikipediaTitle]);

  if (error || !imgUrl) {
    // Fallback to picsum if Wikipedia fails or no title provided
    return (
      <img 
        src={`https://picsum.photos/seed/${encodeURIComponent(fallbackKeyword)}/800/400`} 
        alt={alt}
        referrerPolicy="no-referrer"
        className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
      />
    );
  }

  return (
    <img 
      src={imgUrl} 
      alt={alt} 
      referrerPolicy="no-referrer"
      className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" 
    />
  );
}

export default function DocPlanPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { userId: collabUserId, planId: collabPlanId } = useParams();
  const isCollab = !!(collabUserId && collabPlanId);
  const isShared = location.state?.isShared || false;
  const savedPlan = location.state?.savedPlan;
  
  // Form State
  const [origin, setOrigin] = useState(savedPlan?.origin || '');
  const [destination, setDestination] = useState(savedPlan?.destination || '');
  const [days, setDays] = useState<number | ''>(savedPlan?.days || 3);
  const [peopleCount, setPeopleCount] = useState<number | ''>(savedPlan?.peopleCount || 1);
  const [startDate, setStartDate] = useState(savedPlan?.startDate || '');
  const [endDate, setEndDate] = useState(savedPlan?.endDate || '');
  const [requirements, setRequirements] = useState('');
  const [language, setLanguage] = useState<'zh' | 'en'>('zh');
  
  // App State
  const [loading, setLoading] = useState(false);
  const [plan, setPlan] = useState<TravelPlan | null>(savedPlan ? {
    flightOptions: savedPlan.flightOptions || (savedPlan.selectedFlight ? [savedPlan.selectedFlight] : []),
    days: savedPlan.itinerary || [],
    aiMessage: savedPlan.aiMessage
  } : null);
  const [error, setError] = useState('');
  const [currentPlanId, setCurrentPlanId] = useState<string | null>(savedPlan?.id || collabPlanId || null);

  // Fetch initial data from database or set up collab listener
  useEffect(() => {
    if (isCollab && collabUserId && collabPlanId) {
      const docRef = doc(db, 'users', collabUserId, 'plans', collabPlanId);
      const unsubscribe = onSnapshot(docRef, (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data();
          const parsedPlan = JSON.parse(data.data);
          
          setOrigin(parsedPlan.origin || '');
          setDestination(parsedPlan.destination || '');
          setDays(parsedPlan.days || 3);
          setPeopleCount(parsedPlan.peopleCount || 1);
          setStartDate(parsedPlan.startDate || '');
          setEndDate(parsedPlan.endDate || '');
          setPlan({
            flightOptions: parsedPlan.flightOptions || (parsedPlan.selectedFlight ? [parsedPlan.selectedFlight] : []),
            days: parsedPlan.itinerary || [],
            aiMessage: parsedPlan.aiMessage
          });
          if (parsedPlan.selectedFlight?.id) {
            setSelectedFlightId(parsedPlan.selectedFlight.id);
            setCurrentItineraryFlightId(parsedPlan.selectedFlight.id);
          } else if (parsedPlan.selectedFlightId) {
            setSelectedFlightId(parsedPlan.selectedFlightId);
            setCurrentItineraryFlightId(parsedPlan.selectedFlightId);
          }
        }
      }, (error) => {
        handleFirestoreError(error, OperationType.GET, `users/${collabUserId}/plans/${collabPlanId}`);
      });
      return () => unsubscribe();
    }

    const fetchInitialData = async () => {
      if (auth.currentUser && !savedPlan) {
        try {
          const q = query(
            collection(db, 'users', auth.currentUser.uid, 'plans'),
            orderBy('createdAt', 'desc'),
            limit(1)
          );
          const querySnapshot = await getDocs(q);
          if (!querySnapshot.empty) {
            const lastPlan = JSON.parse(querySnapshot.docs[0].data().data);
            if (lastPlan.peopleCount) {
              setPeopleCount(lastPlan.peopleCount);
            }
          }
        } catch (err) {
          console.error("Error fetching initial people count:", err);
        }
      }
    };

    const authUnsubscribe = onAuthStateChanged(auth, (user) => {
      if (user && !isCollab) {
        fetchInitialData();
      }
    });

    return () => authUnsubscribe();
  }, [isCollab, collabUserId, collabPlanId, savedPlan]);
  
  // Selection & Save State
  const [selectedFlightId, setSelectedFlightId] = useState<string>(savedPlan?.selectedFlight?.id || '');
  const [currentItineraryFlightId, setCurrentItineraryFlightId] = useState<string>(savedPlan?.selectedFlight?.id || '');
  const [isSaved, setIsSaved] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [isCopied, setIsCopied] = useState(false);
  const [replanLoading, setReplanLoading] = useState(false);
  
  // Chat State
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<{role: 'user'|'ai', text: string}[]>([]);
  const [collapsedDays, setCollapsedDays] = useState<number[]>([]);
  const [showBackToTop, setShowBackToTop] = useState(false);

  // Scroll listener for back to top button
  useEffect(() => {
    const handleScroll = () => {
      if (window.scrollY > window.innerHeight) {
        setShowBackToTop(true);
      } else {
        setShowBackToTop(false);
      }
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const toggleDayCollapse = (dayNumber: number) => {
    setCollapsedDays(prev => 
      prev.includes(dayNumber) 
        ? prev.filter(d => d !== dayNumber) 
        : [...prev, dayNumber]
    );
  };

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      alert(language === 'zh' ? '文件太大（限制10MB）' : 'File too large (10MB max)');
      return;
    }

    const fileExtension = file.name.split('.').pop()?.toLowerCase();

    if (fileExtension === 'xlsx' || fileExtension === 'xls') {
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const data = new Uint8Array(event.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: 'array' });
          let textContext = '';
          
          workbook.SheetNames.forEach(sheetName => {
            const worksheet = workbook.Sheets[sheetName];
            const csv = XLSX.utils.sheet_to_csv(worksheet);
            if (csv.trim()) {
              textContext += `\n--- Sheet: ${sheetName} ---\n${csv}\n`;
            }
          });
          
          setRequirements(prev => {
            const textToAdd = `[📄 ${file.name} context]:\n${textContext}\n`;
            return prev ? prev + '\n\n' + textToAdd : textToAdd;
          });
        } catch (err) {
          console.error(err);
          alert(language === 'zh' ? '解析 Excel 文件失败' : 'Failed to parse Excel file');
        }
      };
      reader.onerror = () => alert(language === 'zh' ? '读取文件失败' : 'Failed to read file');
      reader.readAsArrayBuffer(file);
    } else {
      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target?.result as string;
        setRequirements(prev => {
          const textToAdd = `[📄 ${file.name} context]:\n${text}\n`;
          return prev ? prev + '\n\n' + textToAdd : textToAdd;
        });
      };
      reader.onerror = () => {
        alert(language === 'zh' ? '读取文件失败' : 'Failed to read file');
      };
      reader.readAsText(file);
    }
    
    e.target.value = ''; // Reset input so the same file can be selected again
  };

  const t = (translations as any)[language];

  const handleGenerate = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();

    let effectiveDays = Number(days);
    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
        effectiveDays = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1);
        setDays(effectiveDays);
      }
    }

    if (!requirements.trim()) {
      setError(language === 'zh' ? '请在文档输入框中提供行程信息（或上传文档）。' : 'Please provide context or upload a document.');
      return;
    }
    
    setLoading(true);
    setError('');
    // setPlan(null); // Keep old plan until new one is ready
    setSelectedFlightId('');
    setCurrentItineraryFlightId('');
    setIsSaved(false);
    setChatMessages([]);

    try {
      const baseInfo = [];
      if (origin) baseInfo.push(`Origin: ${origin}`);
      if (destination) baseInfo.push(`Destination: ${destination}`);
      if (effectiveDays) baseInfo.push(`Duration: ${effectiveDays} days`);
      const baseInfoStr = baseInfo.length > 0 ? `Basic info:\n- ${baseInfo.join('\n- ')}\n` : '';

      const dateContext = (startDate || endDate) ? `Dates: ${startDate ? startDate : 'Not specified'} to ${endDate ? endDate : 'Not specified'}.` : '';
      const flightQueryExample = (startDate && endDate) 
        ? `Flights from ${origin || 'the origin'} to ${destination || 'the destination'} on ${startDate} returning ${endDate}`
        : (startDate ? `Flights from ${origin || 'the origin'} to ${destination || 'the destination'} on ${startDate}` : `Flights from ${origin || 'the origin'} to ${destination || 'the destination'}`);
        
      const prompt = `Plan a travel itinerary.
      
      ${baseInfoStr}
      ${dateContext}
      
      User Requirements and Context (Extremely important, deduce missing details like destination, origin, or days from here if not provided above):
      ${requirements || 'None'}
      
      CRITICAL: If the User Requirements mention specific destinations, origins, or durations that conflict with the Basic info, PRIORITIZE the User Requirements. If the uploaded document contains an itinerary spanning multiple days (e.g., 5 days, 12 days, etc.), you MUST extract and return EVERY SINGLE DAY described in the document. DO NOT summarize, truncate, or drop days. The length of your resulting 'days' array MUST MATCH the number of days depicted in the document. If days/duration is not specified anywhere, default to whatever is most logical based on the text, but do not artificially compress a long trip into 3 days.
      
      Provide exactly 3 realistic transport options (e.g., Flights or High-Speed Rail) to save output space for the detailed itinerary. 
      CRITICAL: For domestic travel within China (e.g., Beijing to Shanghai), prioritize High-Speed Rail (高铁) as it is often more convenient. 
      For each transport option, provide a 'bookingQuery' that can be used to find tickets (e.g., '${flightQueryExample}').
      
      Then, provide a realistic, engaging daily itinerary. 
      CRITICAL: Base the daily itinerary on the FIRST transport option's schedule. Day 1 activities MUST start AFTER the outbound arrival time. The last day's activities MUST end BEFORE the return departure time.
      
      For each day's 'accommodation', provide a realistic hotel name, description, estimated price per night (in ${language === 'zh' ? 'CNY ¥' : 'USD $'}), star rating (1-5), and a 'bookingQuery' for Google Hotels. Use the provided dates to estimate accurate hotel prices.
      CRITICAL: If there is no accommodation needed for a specific night (e.g., returning home on the last day, or a day trip), set the accommodation name to '温暖的家' (Warm Home), price to '0', and bookingQuery to ''.
      
      Combine both activities, dining, and transportation into a single chronological 'events' array for each day.
      For dining, use type 'dining'. For activities, provide 'searchQuery' (best Google search terms for the place), 'officialWebsite' (the official URL if known, otherwise empty string), and 'wikipediaTitle' (the exact English Wikipedia article title for the attraction).
      
      CRITICAL: Include local "small" transportation (walking, metro, bus, taxi) between activities. "Small" transportation refers ONLY to intra-city transport. For transportation events, provide a 'googleMapsUrl' between the two points.
      
      TOKEN OPTIMIZATION: To ensure the JSON is not truncated for long itineraries (e.g. 10+ days), keep descriptions concise (max 2 sentences) and names clear. 
      
      IMPORTANT: You MUST generate the entire response (including themes, names, descriptions, flight tags, airlines, and details) in ${language === 'zh' ? 'Simplified Chinese (简体中文)' : 'English'}. However, 'wikipediaTitle', 'bookingQuery', and 'googleMapsUrl' MUST always be in English. All prices should be in ${language === 'zh' ? 'CNY ¥' : 'USD $'}.`;
      
      const response = await ai.models.generateContent({
        model: 'gemini-3.1-pro-preview',
        contents: prompt,
        // @ts-ignore
        tools: [{ googleSearch: {} }],
        config: {
          responseMimeType: 'application/json',
          responseSchema: planSchema,
          maxOutputTokens: 16384
        }
      });

      if (response.text) {
        let parsedPlan: TravelPlan;
        try {
          parsedPlan = JSON.parse(response.text) as TravelPlan;
        } catch (e) {
          console.error("JSON Parse Error:", e, response.text);
          throw new Error(language === 'zh' ? '生成的行程数据格式有误，请尝试简化文档或重新生成。' : 'The generated itinerary data is malformed. Please try simplifying the document or regenerating.');
        }
        
        // Update origin and destination if they were missing but detected by AI
        if (!origin && parsedPlan.parsedOrigin) setOrigin(parsedPlan.parsedOrigin);
        if (!destination && parsedPlan.parsedDestination) setDestination(parsedPlan.parsedDestination);
        
        setPlan(parsedPlan);
        let firstFlightId = '';
        if (parsedPlan.flightOptions && parsedPlan.flightOptions.length > 0) {
          firstFlightId = parsedPlan.flightOptions[0].id;
          setSelectedFlightId(firstFlightId);
          setCurrentItineraryFlightId(firstFlightId);
        }
        
        // Auto-save the generated plan
        await handleSavePlan(parsedPlan, firstFlightId);
      } else {
        setError(t.errorFail);
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || t.errorFail);
    } finally {
      setLoading(false);
    }
  };

  const handleReplan = async () => {
    const selectedFlight = plan?.flightOptions.find(f => f.id === selectedFlightId);
    if (!selectedFlight || !plan) return;

    setReplanLoading(true);
    setError('');

    try {
      const dateContext = (startDate || endDate) ? `Dates: ${startDate ? startDate : 'Not specified'} to ${endDate ? endDate : 'Not specified'}.` : '';
      const prompt = `I have selected a new transport option (Flight or Train) for my ${plan.days.length}-day trip from ${origin} to ${destination}.
      ${dateContext}
      Additional requirements: ${requirements || 'None'}.
      
      Transport Details:
      Type: ${selectedFlight.type}
      Outbound: Departs ${selectedFlight.outboundDeparture}, Arrives ${selectedFlight.outboundArrival}
      Return: Departs ${selectedFlight.returnDeparture}, Arrives ${selectedFlight.returnArrival}
      
      Please regenerate the daily itinerary ('days' array) to perfectly match this new schedule. 
      Day 1 activities MUST start AFTER the outbound arrival (${selectedFlight.outboundArrival}).
      The final day's activities MUST end well BEFORE the return departure (${selectedFlight.returnDeparture}).
      
      For each day's 'accommodation', provide a realistic hotel name, description, estimated price per night (in ${language === 'zh' ? 'CNY ¥' : 'USD $'}), star rating (1-5), and a 'bookingQuery' for Google Hotels. Use the provided dates to estimate accurate hotel prices.
      CRITICAL: If there is no accommodation needed for a specific night (e.g., returning home on the last day, or a day trip), set the accommodation name to '温暖的家' (Warm Home), price to '0', and bookingQuery to ''.
      
      Combine both activities, dining, and transportation into a single chronological 'events' array for each day.
      For activities, provide 'searchQuery', 'officialWebsite', 'wikipediaTitle' (English), and 'googleMapsUrl' (English).
      
      CRITICAL: Include local "small" transportation (walking, metro, bus, taxi) between activities. "Small" transportation refers ONLY to intra-city transport; it EXCLUDES inter-city transport like high-speed rail (高铁) or flights. For transportation events, provide a 'googleMapsUrl' that is a direct link to Google Maps directions between the two points.
      
      IMPORTANT: Generate the response in ${language === 'zh' ? 'Simplified Chinese (简体中文)' : 'English'}. 'wikipediaTitle', 'bookingQuery', and 'googleMapsUrl' MUST always be in English. All prices should be in ${language === 'zh' ? 'CNY ¥' : 'USD $'}.`;
      
      const response = await ai.models.generateContent({
        model: 'gemini-3.1-pro-preview',
        contents: prompt,
        // @ts-ignore
        tools: [{ googleSearch: {} }],
        config: {
          responseMimeType: 'application/json',
          responseSchema: planSchema,
          maxOutputTokens: 16384
        }
      });

      if (response.text) {
        let parsed: any;
        try {
          parsed = JSON.parse(response.text);
        } catch (e) {
          console.error("JSON Parse Error (Replan):", e, response.text);
          throw new Error(language === 'zh' ? '重新规划失败：数据格式不完整。' : 'Replan failed: Incomplete data format.');
        }
        setPlan(parsed);
        setCurrentItineraryFlightId(selectedFlight.id);
        
        // Auto-save the replanned itinerary
        await handleSavePlan(parsed, selectedFlight.id);
      } else {
        setError(t.errorFail);
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || t.errorFail);
    } finally {
      setReplanLoading(false);
    }
  };

  const handleSendMessage = async () => {
    if (!chatInput.trim() || !plan) return;
    
    const userMsg = chatInput.trim();
    setChatInput('');
    setChatMessages(prev => [...prev, { role: 'user', text: userMsg }]);
    setIsChatLoading(true);
    
    try {
      const prompt = `You are a travel assistant. The user wants to modify their current itinerary.
      Current Itinerary JSON: ${JSON.stringify(plan)}
      User request: ${userMsg}
      
      Please modify the itinerary according to the user's request. Keep the same JSON structure, but ADD a new field 'aiMessage' at the root level.
      'aiMessage' should be a dynamic, friendly response explaining exactly what was updated (e.g., "I've updated your dinner to a highly-rated sushi restaurant and adjusted the timing.").
      Return ONLY the updated JSON object containing 'flightOptions', 'days', and 'aiMessage'.
      Ensure dining events use type 'dining'.
      CRITICAL: Always include local "small" transportation (walking, metro, bus, taxi) between activities with 'googleMapsUrl' links. "Small" transportation refers ONLY to intra-city transport; it EXCLUDES inter-city transport like high-speed rail (高铁) or flights.
      IMPORTANT: Generate the content (including aiMessage) in ${language === 'zh' ? 'Simplified Chinese (简体中文)' : 'English'}. 'wikipediaTitle', 'bookingQuery', and 'googleMapsUrl' MUST always be in English. All prices should be in ${language === 'zh' ? 'CNY ¥' : 'USD $'}.`;
      
      const response = await ai.models.generateContent({
        model: 'gemini-3.1-pro-preview',
        contents: prompt,
        // @ts-ignore
        tools: [{ googleSearch: {} }],
        config: {
          responseMimeType: 'application/json',
          responseSchema: planSchema,
          maxOutputTokens: 16384
        }
      });
      
      if (response.text) {
        let updatedPlan: TravelPlan;
        try {
          updatedPlan = JSON.parse(response.text) as TravelPlan;
        } catch (e) {
          console.error("JSON Parse Error (Chat):", e, response.text);
          throw new Error(language === 'zh' ? '修改行程失败：生成的回复不完整。' : 'Failed to modify itinerary: Incomplete response.');
        }
        setPlan(updatedPlan);
        
        // Auto-save the modified plan
        await handleSavePlan(updatedPlan, selectedFlightId);
        
        const defaultMsg = language === 'zh' ? '行程已更新！看看还有什么需要调整的吗？' : 'Itinerary updated! Let me know if you need any other changes.';
        setChatMessages(prev => [...prev, { role: 'ai', text: updatedPlan.aiMessage || defaultMsg }]);
      }
    } catch (err) {
      console.error(err);
      setChatMessages(prev => [...prev, { role: 'ai', text: language === 'zh' ? '抱歉，更新行程时出错了，请重试。' : 'Sorry, there was an error updating the itinerary. Please try again.' }]);
    } finally {
      setIsChatLoading(false);
    }
  };

  const handleSavePlan = async (planData?: TravelPlan, flightId?: string) => {
    if (isShared) return; // Do not auto-save shared plans

    const currentPlan = planData || plan;
    const currentFlightId = flightId !== undefined ? flightId : selectedFlightId;
    
    if (!currentPlan) return;
    
    const finalOrigin = currentPlan.parsedOrigin || origin;
    const finalDestination = currentPlan.parsedDestination || destination;

    const planToSave = {
      id: Date.now().toString() + '-' + Math.random().toString(36).substr(2, 9),
      origin: finalOrigin,
      destination: finalDestination,
      days: currentPlan.days.length,
      peopleCount: Number(peopleCount) || 1,
      startDate,
      endDate,
      createdAt: new Date().toISOString(),
      flightOptions: currentPlan.flightOptions,
      selectedFlight: currentPlan.flightOptions.find(f => f.id === currentFlightId),
      itinerary: currentPlan.days
    };

    if (auth.currentUser || isCollab) {
      const userIdToSave = isCollab ? collabUserId! : auth.currentUser!.uid;
      try {
        if (currentPlanId) {
          const docRef = doc(db, 'users', userIdToSave, 'plans', currentPlanId);
          await updateDoc(docRef, {
            destination: finalDestination ? finalDestination.substring(0, 190) : 'Custom',
            origin: finalOrigin ? finalOrigin.substring(0, 190) : 'Custom',
            days: currentPlan.days.length,
            theme: requirements ? requirements.substring(0, 90) : 'General',
            data: JSON.stringify(planToSave)
          });
        } else {
          const docRef = doc(collection(db, 'users', auth.currentUser!.uid, 'plans'));
          await setDoc(docRef, {
            userId: auth.currentUser!.uid,
            destination: finalDestination ? finalDestination.substring(0, 190) : 'Custom',
            origin: finalOrigin ? finalOrigin.substring(0, 190) : 'Custom',
            days: currentPlan.days.length,
            theme: requirements ? requirements.substring(0, 90) : 'General',
            createdAt: planToSave.createdAt,
            data: JSON.stringify(planToSave)
          });
          setCurrentPlanId(docRef.id);
        }
      } catch (error) {
        handleFirestoreError(error, currentPlanId ? OperationType.UPDATE : OperationType.CREATE, `users/${userIdToSave}/plans`);
      }
    } else {
      const existingPlans = JSON.parse(localStorage.getItem('saved_travel_plans') || '[]');
      localStorage.setItem('saved_travel_plans', JSON.stringify([...existingPlans, planToSave]));
    }
    
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 3000);
  };

  const handleCollab = async () => {
    if (!plan || !auth.currentUser) {
      if (!auth.currentUser) {
        alert(language === 'zh' ? '请先登录以邀请共创' : 'Please log in to invite collaborators');
      }
      return;
    }
    
    if (!currentPlanId) {
      alert(language === 'zh' ? '请先保存行程' : 'Please save the itinerary first');
      return;
    }

    setIsSharing(true);
    try {
      const docRef = doc(db, 'users', auth.currentUser.uid, 'plans', currentPlanId);
      await updateDoc(docRef, {
        isPublicEdit: true
      });

      const url = `${window.location.origin}/collab/plan/${auth.currentUser.uid}/${currentPlanId}`;
      setShareUrl(url);
      setIsCopied(false);
      
      try {
        await navigator.clipboard.writeText(url);
        setIsCopied(true);
        setTimeout(() => setIsCopied(false), 2000);
      } catch (err) {
        console.error("Failed to copy:", err);
      }
    } catch (error) {
      console.error("Error setting up collab:", error);
      alert(language === 'zh' ? '设置共创失败，请重试' : 'Failed to set up collaboration, please try again');
    } finally {
      setIsSharing(false);
    }
  };

  const handleAddToMyPlans = async () => {
    if (!plan) return;
    
    const planToSave = {
      id: Date.now().toString() + '-' + Math.random().toString(36).substr(2, 9),
      origin,
      destination,
      days: plan.days.length,
      peopleCount: Number(peopleCount) || 1,
      startDate,
      endDate,
      createdAt: new Date().toISOString(),
      flightOptions: plan.flightOptions,
      selectedFlight: plan.flightOptions.find(f => f.id === selectedFlightId),
      itinerary: plan.days
    };

    if (auth.currentUser) {
      try {
        const docRef = doc(collection(db, 'users', auth.currentUser.uid, 'plans'));
        await setDoc(docRef, {
          userId: auth.currentUser.uid,
          destination,
          origin,
          days: plan.days.length,
          theme: requirements || 'General',
          createdAt: planToSave.createdAt,
          data: JSON.stringify(planToSave)
        });
        alert(language === 'zh' ? '已添加到我的行程！' : 'Added to my plans!');
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, `users/${auth.currentUser.uid}/plans`);
      }
    } else {
      const existingPlans = JSON.parse(localStorage.getItem('saved_travel_plans') || '[]');
      localStorage.setItem('saved_travel_plans', JSON.stringify([...existingPlans, planToSave]));
      alert(language === 'zh' ? '已添加到本地行程！' : 'Added to local plans!');
    }
  };

  return (
    <div className="min-h-screen bg-[#faf9f8] p-4 md:p-8 font-sans selection:bg-blue-100 pb-32">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <button 
            onClick={() => navigate('/')}
            className="flex items-center gap-2 text-gray-500 hover:text-gray-900 transition-colors font-medium"
          >
            <ArrowLeft size={20} />
            {t.back}
          </button>
          
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate('/my-plans')}
              className="text-sm font-semibold text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100 px-4 py-2 rounded-full transition-colors"
            >
              {t.myPlans}
            </button>
            {/* Language Toggle */}
            <div className="flex items-center bg-white rounded-full p-1 border border-gray-200 shadow-sm">
              <button
                onClick={() => setLanguage('zh')}
                className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${language === 'zh' ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-900'}`}
              >
                中文
              </button>
              <button
                onClick={() => setLanguage('en')}
                className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${language === 'en' ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-900'}`}
              >
                EN
              </button>
            </div>
            <GlobalAuth />
          </div>
        </div>
        
        <div className="mb-8 flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <h1 className="text-4xl font-bold text-gray-900 tracking-tight flex items-center gap-3">
              <Upload className="text-purple-500" size={32} />
              {language === 'zh' ? '智能文档规划' : 'Document Planner'}
            </h1>
            <p className="text-gray-500 mt-2 text-lg">{language === 'zh' ? '上传攻略、游记或备忘录，AI 为您一键生成行程。' : 'Upload guides or notes, and let AI generate your itinerary.'}</p>
          </div>
          {(!isShared && !isCollab) && (
            <button
              onClick={() => navigate('/plan')}
              className="flex items-center gap-2 px-5 py-2.5 bg-white hover:bg-gray-50 text-gray-700 border border-gray-200 rounded-xl font-medium transition-all shadow-sm"
            >
              <ArrowLeft size={18} />
              {language === 'zh' ? '返回基础规划' : 'Back to Basic Planner'}
            </button>
          )}
        </div>

        {/* Input Form or Shared Info */}
        {(!isShared && !isCollab) ? (
          <form onSubmit={handleGenerate} className="bg-white rounded-3xl shadow-sm border border-gray-100 p-6 md:p-8 mb-12">
            
            {/* Requirements & Context Upload */}
            <div className="space-y-4 mb-6">
              <div className="flex items-center justify-between">
                <label className="text-lg font-bold text-gray-900 flex items-center gap-2">
                  <Info className="text-purple-500"/> {language === 'zh' ? '行程要求与参考文档' : 'Requirements & Context'}
                </label>
                <label className="cursor-pointer flex items-center gap-2 text-sm text-purple-600 hover:text-purple-700 font-medium transition-colors bg-purple-50 hover:bg-purple-100 px-4 py-2 rounded-xl border border-purple-100">
                  <Upload size={16} />
                  {language === 'zh' ? '上传参考文档 (TXT/MD/XLSX/CSV)' : 'Upload Context (TXT/MD/XLSX/CSV)'}
                  <input type="file" accept=".txt,.json,.csv,.md,.xls,.xlsx" className="hidden" onChange={handleFileUpload} />
                </label>
              </div>
              <textarea 
                value={requirements}
                onChange={e => setRequirements(e.target.value)}
                placeholder={language === 'zh' ? '请在这里粘贴或输入您的完整旅行计划、记事本内容、游记参考等。AI 将自动提取目的地、天数和偏好为您生成专属行程规划...\n\n例如：\n我想去日本玩5天。必去景点有东京铁塔、浅草寺、秋叶原...\n或者直接上传您的攻略文档！' : 'Paste your travel notes, itinerary drafts, or requirements here. AI will automatically extract the destination, duration, and preferences to generate an itinerary...\n\nE.g.:\nA 5-day trip to Japan. Must-visit places: Tokyo Tower, Senso-ji, Akihabara...\nOr directly upload your travel document!'}
                rows={10}
                className="w-full px-5 py-4 rounded-2xl border border-gray-200 focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none transition-all bg-gray-50/50 focus:bg-white resize-y text-base"
              />
            </div>
            
            <div className="flex items-center gap-6 mb-8 bg-blue-50/50 p-4 rounded-2xl border border-blue-100/50">
              {/* People Count */}
              <div className="flex-1 flex items-center gap-4">
                <label className="text-sm font-semibold text-gray-700 flex items-center gap-2 whitespace-nowrap">
                  <Users size={16} className="text-blue-500"/> {t.peopleCount}
                </label>
                <input 
                  type="number" 
                  min="1"
                  max="100"
                  value={peopleCount}
                  onChange={e => setPeopleCount(e.target.value === '' ? '' : Number(e.target.value))}
                  onKeyDown={e => e.key === 'Enter' && e.preventDefault()}
                  className="max-w-[120px] px-4 py-2 rounded-xl border border-gray-200 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all bg-white"
                  required
                />
              </div>
            </div>

            {error && (
              <div className="mb-6 p-4 bg-red-50 text-red-600 rounded-xl text-sm font-medium border border-red-100">
                {error}
              </div>
            )}

            <button 
              type="submit" 
              disabled={loading}
              className="w-full md:w-auto px-8 py-3.5 bg-gray-900 hover:bg-gray-800 text-white rounded-xl font-semibold transition-all flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed shadow-md shadow-gray-900/10"
            >
              {loading ? (
                <>
                  <Loader2 size={20} className="animate-spin" />
                  {t.generating}
                </>
              ) : (
                <>
                  <Sparkles size={20} />
                  {t.generate}
                </>
              )}
            </button>
          </form>
        ) : (
          <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-6 md:p-8 mb-12 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <h3 className="text-2xl font-bold text-gray-900 mb-2 flex items-center gap-2">
                <MapPin className="text-rose-500" size={24} />
                {origin || (language === 'zh' ? '自定义行程' : 'Custom Plan')} {destination ? <><ArrowLeft size={16} className="rotate-180 text-gray-400 mx-1" /> {destination}</> : ''}
              </h3>
              <div className="flex items-center gap-4 text-gray-600 font-medium">
                <span className="flex items-center gap-1.5"><Calendar size={18} className="text-emerald-500"/> {days} {t.days}</span>
                <span className="flex items-center gap-1.5"><Users size={18} className="text-blue-500"/> {peopleCount} {t.peopleCount}</span>
              </div>
            </div>
            
            {(isShared || (isCollab && auth.currentUser?.uid !== collabUserId)) && (
              <button
                onClick={handleAddToMyPlans}
                className="w-full sm:w-auto px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold transition-all flex items-center justify-center gap-2 shadow-md shadow-blue-600/20"
              >
                <Plus size={20} />
                {language === 'zh' ? '添加到我的行程' : 'Add to my plans'}
              </button>
            )}
          </div>
        )}

        {/* Results Section */}
        {plan && (
          <div className={`space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-700 relative ${loading ? 'opacity-50 pointer-events-none' : ''}`}>
            {loading && (
              <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-white/40 backdrop-blur-[2px] rounded-3xl">
                <div className="bg-white p-8 rounded-2xl shadow-xl border border-gray-100 flex flex-col items-center">
                  <Loader2 size={48} className="text-blue-500 animate-spin mb-4" />
                  <h3 className="text-xl font-bold text-gray-900">{t.generating}</h3>
                </div>
              </div>
            )}
            
            {/* Flight Options Grid */}
            {plan.flightOptions && plan.flightOptions.length > 0 && (!isShared || plan.flightOptions.some(f => f.id === selectedFlightId)) && (
              isShared ? (
                (() => {
                  const flight = plan.flightOptions.find(f => f.id === selectedFlightId) || plan.flightOptions[0];
                  return (
                    <div className="mb-10 bg-white p-6 rounded-2xl border border-blue-100 shadow-sm relative overflow-hidden">
                      <div className="absolute top-0 right-0 p-6 opacity-5 pointer-events-none">
                        {flight.type === 'train' ? (
                          <Train size={80} className="rotate-12" />
                        ) : (
                          <Plane size={80} className="rotate-45" />
                        )}
                      </div>
                      <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                        {flight.type === 'train' ? (
                          <>
                            <Train className="text-blue-500" size={20} />
                            {language === 'zh' ? '已选车次' : 'Selected Train'}
                          </>
                        ) : (
                          <>
                            <Ticket className="text-blue-500" size={20} />
                            {language === 'zh' ? '已选航班' : 'Selected Flight'}
                          </>
                        )}
                      </h3>
                      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
                        <div>
                          <div className="inline-block px-3 py-1 bg-blue-100 text-blue-700 text-xs font-bold rounded-lg mb-2">
                            {flight.tag}
                          </div>
                          <div className="font-bold text-gray-900">{flight.airline}</div>
                        </div>
                        <div className="flex gap-6">
                          <div>
                            <div className="text-xs text-gray-500 uppercase font-semibold mb-1">{t.outbound}</div>
                            <div className="flex items-center gap-3 bg-gray-50 p-2 rounded-lg">
                              <div className="text-center">
                                <div className="text-sm font-bold text-gray-900">{flight.outboundDeparture}</div>
                                <div className="text-[10px] text-gray-500">{flight.type === 'train' ? t.trainDeparture : t.departure}</div>
                              </div>
                              <div className="flex flex-col items-center justify-center px-2">
                                <span className="text-[9px] text-gray-500 font-medium mb-1 whitespace-nowrap">{flight.outboundTransit}</span>
                                <div className="h-px bg-gray-300 w-full relative min-w-[40px]">
                                  {flight.type === 'train' ? (
                                    <Train size={12} className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-gray-400 bg-gray-50 px-0.5" />
                                  ) : (
                                    <PlaneTakeoff size={12} className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-gray-400 bg-gray-50 px-0.5" />
                                  )}
                                </div>
                              </div>
                              <div className="text-center">
                                <div className="text-sm font-bold text-gray-900">
                                  {flight.outboundArrival}
                                  {flight.outboundCrossDay && <span className="text-[10px] text-red-500 ml-0.5 align-top">{flight.outboundCrossDay}</span>}
                                </div>
                                <div className="text-[10px] text-gray-500">{flight.type === 'train' ? t.trainArrival : t.arrival}</div>
                              </div>
                            </div>
                          </div>
                          <div>
                            <div className="text-xs text-gray-500 uppercase font-semibold mb-1">{flight.type === 'train' ? t.returnTrain : t.returnFlight}</div>
                            <div className="flex items-center gap-3 bg-gray-50 p-2 rounded-lg">
                              <div className="text-center">
                                <div className="text-sm font-bold text-gray-900">{flight.returnDeparture}</div>
                                <div className="text-[10px] text-gray-500">{flight.type === 'train' ? t.trainDeparture : t.departure}</div>
                              </div>
                              <div className="flex flex-col items-center justify-center px-2">
                                <span className="text-[9px] text-gray-500 font-medium mb-1 whitespace-nowrap">{flight.returnTransit}</span>
                                <div className="h-px bg-gray-300 w-full relative min-w-[40px]">
                                  {flight.type === 'train' ? (
                                    <Train size={12} className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-gray-400 bg-gray-50 px-0.5" />
                                  ) : (
                                    <PlaneLanding size={12} className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-gray-400 bg-gray-50 px-0.5" />
                                  )}
                                </div>
                              </div>
                              <div className="text-center">
                                <div className="text-sm font-bold text-gray-900">
                                  {flight.returnArrival}
                                  {flight.returnCrossDay && <span className="text-[10px] text-red-500 ml-0.5 align-top">{flight.returnCrossDay}</span>}
                                </div>
                                <div className="text-[10px] text-gray-500">{flight.type === 'train' ? t.trainArrival : t.arrival}</div>
                              </div>
                            </div>
                          </div>
                        </div>
                        <div className="font-bold text-xl text-gray-900">
                          {flight.price}
                        </div>
                      </div>
                    </div>
                  );
                })()
              ) : (
              <div className="bg-white p-6 md:p-8 rounded-3xl border border-gray-100 shadow-sm">
                <div className="flex flex-col md:flex-row md:items-center justify-between mb-6 gap-4">
                  <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
                    {t.flightTitle}
                  </h2>
                  <button 
                    onClick={() => navigate('/flights', { state: { origin, destination, startDate } })}
                    className="flex text-sm items-center justify-center gap-2 px-4 py-2 bg-blue-50 text-blue-600 rounded-xl hover:bg-blue-100 transition-colors font-medium border border-blue-100/50"
                  >
                    {language === 'zh' ? '选择更多航班/车次' : 'More Transport Options'}
                    <ExternalLink size={16} />
                  </button>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {plan.flightOptions.map((flight) => {
                    const isSelected = selectedFlightId === flight.id;
                    
                    return (
                      <div 
                        key={flight.id}
                        onClick={() => {
                          if (isShared) return;
                          setSelectedFlightId(flight.id);
                          handleSavePlan(plan, flight.id);
                        }}
                        className={`relative p-5 rounded-2xl border-2 transition-all duration-300 ${
                          isShared ? 'border-blue-500 bg-blue-50/50 shadow-md shadow-blue-500/10 cursor-default' :
                          isSelected 
                            ? 'border-blue-500 bg-blue-50/50 shadow-md shadow-blue-500/10 cursor-pointer' 
                            : 'border-gray-100 hover:border-blue-200 hover:bg-gray-50 cursor-pointer'
                        }`}
                      >
                      {/* Selection Indicator */}
                      <div className="absolute top-4 right-4">
                        {isSelected ? (
                          <CheckCircle2 className="text-blue-500" size={24} />
                        ) : (
                          <Circle className="text-gray-300" size={24} />
                        )}
                      </div>

                      <div className="flex items-center gap-2 mb-3">
                        <div className={`p-2 rounded-lg ${isSelected ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-500'}`}>
                          {flight.type === 'train' ? <Train size={18} /> : <Plane size={18} />}
                        </div>
                        <div className="inline-block px-3 py-1 bg-blue-100 text-blue-700 text-xs font-bold rounded-lg">
                          {flight.tag}
                        </div>
                      </div>
                      
                      <h3 className="font-bold text-gray-900 text-lg mb-4">{flight.airline}</h3>
                      
                      <div className="space-y-4 mb-6">
                        <div>
                          <div className="text-xs text-gray-500 uppercase font-semibold mb-1">{t.outbound}</div>
                          <div className="flex items-center justify-between bg-gray-50 p-2 rounded-lg">
                            <div className="text-center">
                              <div className="text-sm font-bold text-gray-900">{flight.outboundDeparture}</div>
                              <div className="text-[10px] text-gray-500">{flight.type === 'train' ? t.trainDeparture : t.departure}</div>
                            </div>
                            <div className="flex-1 px-2 flex flex-col items-center justify-center">
                              <span className="text-[9px] text-gray-500 font-medium mb-1 whitespace-nowrap">{flight.outboundTransit}</span>
                              <div className="h-px bg-gray-300 w-full relative">
                                {flight.type === 'train' ? (
                                  <Train size={12} className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-gray-400 bg-gray-50 px-0.5" />
                                ) : (
                                  <PlaneTakeoff size={12} className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-gray-400 bg-gray-50 px-0.5" />
                                )}
                              </div>
                            </div>
                            <div className="text-center">
                              <div className="text-sm font-bold text-gray-900">
                                {flight.outboundArrival}
                                {flight.outboundCrossDay && <span className="text-[10px] text-red-500 ml-0.5 align-top">{flight.outboundCrossDay}</span>}
                              </div>
                              <div className="text-[10px] text-gray-500">{flight.type === 'train' ? t.trainArrival : t.arrival}</div>
                            </div>
                          </div>
                        </div>
                        
                        <div>
                          <div className="text-xs text-gray-500 uppercase font-semibold mb-1">{t.returnFlight}</div>
                          <div className="flex items-center justify-between bg-gray-50 p-2 rounded-lg">
                            <div className="text-center">
                              <div className="text-sm font-bold text-gray-900">{flight.returnDeparture}</div>
                              <div className="text-[10px] text-gray-500">{flight.type === 'train' ? t.trainDeparture : t.departure}</div>
                            </div>
                            <div className="flex-1 px-2 flex flex-col items-center justify-center">
                              <span className="text-[9px] text-gray-500 font-medium mb-1 whitespace-nowrap">{flight.returnTransit}</span>
                              <div className="h-px bg-gray-300 w-full relative">
                                {flight.type === 'train' ? (
                                  <Train size={12} className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-gray-400 bg-gray-50 px-0.5" />
                                ) : (
                                  <PlaneLanding size={12} className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-gray-400 bg-gray-50 px-0.5" />
                                )}
                              </div>
                            </div>
                            <div className="text-center">
                              <div className="text-sm font-bold text-gray-900">
                                {flight.returnArrival}
                                {flight.returnCrossDay && <span className="text-[10px] text-red-500 ml-0.5 align-top">{flight.returnCrossDay}</span>}
                              </div>
                              <div className="text-[10px] text-gray-500">{flight.type === 'train' ? t.trainArrival : t.arrival}</div>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="pt-4 border-t border-gray-200/60">
                        <div className="flex items-center justify-between mb-3">
                          <div className="font-bold text-2xl text-gray-900">{flight.price}</div>
                        </div>
                        
                        {isSelected && (
                          <div className="flex flex-col gap-2">
                            {flight.type === 'train' && language === 'zh' ? (
                              <>
                                <a 
                                  href="https://trains.ctrip.com/"
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="w-full text-sm font-bold text-blue-600 hover:text-blue-700 flex items-center justify-center gap-2 bg-blue-100/50 py-2.5 rounded-xl transition-colors"
                                >
                                  <Search size={16} />
                                  去携程预订
                                </a>
                                <a 
                                  href="https://www.12306.cn/"
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="w-full text-sm font-bold text-emerald-600 hover:text-emerald-700 flex items-center justify-center gap-2 bg-emerald-100/50 py-2.5 rounded-xl transition-colors"
                                >
                                  <Train size={16} />
                                  去 12306 预订
                                </a>
                              </>
                            ) : (
                              <a 
                                href={flight.type === 'train' 
                                  ? `https://www.google.com/search?q=${encodeURIComponent(flight.bookingQuery)}`
                                  : `https://www.google.com/travel/flights?q=${encodeURIComponent(flight.bookingQuery)}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="w-full text-sm font-bold text-blue-600 hover:text-blue-700 flex items-center justify-center gap-2 bg-blue-100/50 py-2.5 rounded-xl transition-colors"
                              >
                                <Search size={16} />
                                {t.searchFlights}
                              </a>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              
              {selectedFlightId !== currentItineraryFlightId && (
                <div className="mt-6 flex justify-end animate-in fade-in slide-in-from-top-2">
                  <button
                    onClick={handleReplan}
                    disabled={replanLoading}
                    className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold transition-all flex items-center gap-2 shadow-md shadow-blue-600/20 disabled:opacity-70 disabled:cursor-not-allowed"
                  >
                    {replanLoading ? (
                      <>
                        <Loader2 size={18} className="animate-spin" />
                        {t.replanning}
                      </>
                    ) : (
                      <>
                        <Sparkles size={18} />
                        {t.replan}
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
            )
            )}

            {/* Daily Itinerary */}
            <div className="flex justify-end mb-6 gap-3">
              <button 
                onClick={() => setCollapsedDays([])}
                className="text-xs font-bold text-blue-600 hover:text-blue-700 bg-blue-50 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5"
              >
                <ChevronsUpDown size={14} />
                {language === 'zh' ? '全部展开' : 'Expand All'}
              </button>
              <button 
                onClick={() => setCollapsedDays(plan.days.map(d => d.dayNumber))}
                className="text-xs font-bold text-gray-500 hover:text-gray-600 bg-gray-100 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5"
              >
                <ChevronsDownUp size={14} />
                {language === 'zh' ? '全部折叠' : 'Collapse All'}
              </button>
            </div>

            {plan.days.map((day) => {
              const selectedFlight = plan.flightOptions.find(f => f.id === currentItineraryFlightId);
              let displayEvents = [...day.events];
              
              if (selectedFlight) {
                if (day.dayNumber === 1) {
                  displayEvents.unshift({
                    time: `${selectedFlight.outboundDeparture} - ${selectedFlight.outboundArrival} ${selectedFlight.outboundCrossDay}`.trim(),
                    type: 'transportation',
                    title: `${selectedFlight.type === 'train' ? '🚆' : '✈️'} ${t.outbound} - ${selectedFlight.airline}`,
                    description: `${selectedFlight.tag} option. Transit: ${selectedFlight.outboundTransit}. Price: ${selectedFlight.price}`,
                    searchQuery: selectedFlight.bookingQuery,
                    officialWebsite: selectedFlight.type === 'train' 
                      ? `https://www.google.com/search?q=${encodeURIComponent(selectedFlight.bookingQuery)}`
                      : `https://www.google.com/travel/flights?q=${encodeURIComponent(selectedFlight.bookingQuery)}`,
                    wikipediaTitle: '',
                    googleMapsUrl: ''
                  });
                }
                if (day.dayNumber === plan.days.length) {
                  displayEvents.push({
                    time: `${selectedFlight.returnDeparture} - ${selectedFlight.returnArrival} ${selectedFlight.returnCrossDay}`.trim(),
                    type: 'transportation',
                    title: `${selectedFlight.type === 'train' ? '🚆' : '✈️'} ${t.returnFlight} - ${selectedFlight.airline}`,
                    description: `${selectedFlight.tag} option. Transit: ${selectedFlight.returnTransit}. Price: ${selectedFlight.price}`,
                    searchQuery: selectedFlight.bookingQuery,
                    officialWebsite: selectedFlight.type === 'train' 
                      ? `https://www.google.com/search?q=${encodeURIComponent(selectedFlight.bookingQuery)}`
                      : `https://www.google.com/travel/flights?q=${encodeURIComponent(selectedFlight.bookingQuery)}`,
                    wikipediaTitle: '',
                    googleMapsUrl: ''
                  });
                }
              }

              const isCollapsed = collapsedDays.includes(day.dayNumber);

              return (
              <div key={day.dayNumber} className="relative mb-12">
                {/* Day Header */}
                <div 
                  onClick={() => toggleDayCollapse(day.dayNumber)}
                  className="flex items-center justify-between gap-4 mb-6 cursor-pointer group"
                >
                  <div className="flex items-center gap-4">
                    <div className="bg-blue-600 text-white w-14 h-14 rounded-2xl flex items-center justify-center font-bold text-2xl shadow-sm shadow-blue-600/20 shrink-0 group-hover:scale-105 transition-transform">
                      {day.dayNumber}
                    </div>
                    <div>
                      <h2 className="text-2xl font-bold text-gray-900 group-hover:text-blue-600 transition-colors">{day.theme}</h2>
                      <p className="text-gray-500 font-medium">{t.dayPrefix} {day.dayNumber} {t.dayOf} {days} {t.daySuffix}</p>
                    </div>
                  </div>
                  <div className={`p-2 rounded-full transition-all ${isCollapsed ? 'bg-gray-100 text-gray-400' : 'bg-blue-100 text-blue-600 rotate-180'}`}>
                    <ChevronDown size={24} />
                  </div>
                </div>
                
                {!isCollapsed && (
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 animate-in fade-in slide-in-from-top-4 duration-300">
                    {/* Left Column: Accommodation (Sticky) */}
                  <div className="lg:col-span-4">
                    <div className="sticky top-8 space-y-6">
                      <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm">
                        <div className="flex items-center justify-between mb-4">
                          <div className="flex items-center gap-3 text-purple-600">
                            <div className="p-2 bg-purple-50 rounded-xl">
                              <Hotel size={20} />
                            </div>
                            <h3 className="font-bold text-gray-900">{t.accommodation}</h3>
                          </div>
                          {!(day.accommodation.name.includes('温暖的家') || day.accommodation.name.includes('Warm Home') || day.accommodation.price === '0' || day.accommodation.price === '$0' || day.accommodation.price === '¥0' || day.accommodation.price === '0元') && (
                            <div className="flex items-center gap-1 text-amber-500">
                              {Array.from({ length: Math.min(5, Math.max(1, day.accommodation.stars || 3)) }).map((_, i) => (
                                <Sparkles key={i} size={14} fill="currentColor" />
                              ))}
                            </div>
                          )}
                        </div>
                        <p className="font-bold text-gray-900 text-lg leading-tight">{day.accommodation.name}</p>
                        {!(day.accommodation.name.includes('温暖的家') || day.accommodation.name.includes('Warm Home') || day.accommodation.price === '0' || day.accommodation.price === '$0' || day.accommodation.price === '¥0' || day.accommodation.price === '0元') && (
                          <div className="flex items-center gap-2 mt-2">
                            <span className="text-emerald-600 font-bold text-lg">{day.accommodation.price}</span>
                            <span className="text-gray-400 text-xs font-medium">/ {language === 'zh' ? '晚' : 'night'}</span>
                          </div>
                        )}
                        <p className="text-sm text-gray-500 mt-3 leading-relaxed">{day.accommodation.description}</p>
                        
                        {!(day.accommodation.name.includes('温暖的家') || day.accommodation.name.includes('Warm Home') || day.accommodation.price === '0' || day.accommodation.price === '$0' || day.accommodation.price === '¥0' || day.accommodation.price === '0元') && (
                          <a 
                            href={`https://www.google.com/travel/hotels?q=${encodeURIComponent(day.accommodation.bookingQuery || day.accommodation.name)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-6 w-full flex items-center justify-center gap-2 bg-purple-50 hover:bg-purple-100 text-purple-600 font-bold py-3 rounded-xl transition-all text-sm"
                          >
                            <Search size={16} />
                            {language === 'zh' ? '在 Google Hotels 预订' : 'Book on Google Hotels'}
                          </a>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Right Column: Unified Events Timeline */}
                  <div className="lg:col-span-8">
                    <div className="bg-white p-6 md:p-8 rounded-3xl border border-gray-100 shadow-sm">
                      <div className="flex items-center gap-3 text-orange-600 mb-8">
                        <div className="p-2 bg-orange-50 rounded-xl">
                          <Map size={20} />
                        </div>
                        <h3 className="font-bold text-gray-900">{t.itinerary}</h3>
                      </div>
                      
                      <div className="space-y-8 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px before:h-full before:w-0.5 before:bg-gradient-to-b before:from-gray-200 before:to-transparent">
                        {displayEvents.map((event, i) => {
                          const isTransport = event.type === 'transportation';
                          const isDining = event.type === 'dining';
                          const isFlight = event.title.includes('✈️');
                          const Icon = isFlight ? Plane : (isTransport ? getTransportIcon(event.title, event.description) : (isDining ? Utensils : Camera));
                          const iconColorClass = isFlight ? 'text-blue-600 bg-blue-100 border-white' : 
                                                 (isTransport ? 'text-emerald-600 bg-emerald-100 border-white' : 
                                                 (isDining ? 'text-rose-600 bg-rose-100 border-white' : 'text-orange-600 bg-orange-100 border-white'));
                          const badgeColorClass = isFlight ? 'text-blue-700 bg-blue-50 border-blue-100' : 
                                                  (isTransport ? 'text-emerald-700 bg-emerald-50 border-emerald-100' : 
                                                  (isDining ? 'text-rose-700 bg-rose-50 border-rose-100' : 'text-orange-700 bg-orange-50 border-orange-100'));
                          const typeLabel = isFlight ? t.flightTitle.replace('✈️ ', '') : 
                                            (isTransport ? t.transportation : 
                                            (isDining ? t.dining : t.activity));
                          
                          // Determine the link URL
                          const linkUrl = event.officialWebsite || `https://www.google.com/search?q=${encodeURIComponent(event.searchQuery)}`;
                          
                          return (
                            <div key={i} className="relative flex items-start gap-6 group">
                              {/* Timeline dot/icon */}
                              <div className={`flex items-center justify-center w-10 h-10 rounded-full border-4 shadow-sm shrink-0 z-10 mt-1 ${iconColorClass}`}>
                                <Icon size={16} />
                              </div>
                              
                              {/* Content Card */}
                              <div className="flex-1 p-5 rounded-2xl bg-gray-50 border border-gray-100 group-hover:bg-white group-hover:shadow-md group-hover:border-gray-200 transition-all">
                                {/* Image for Activities (Not for transport or dining) */}
                                {(!isTransport && !isDining) && (
                                  <a 
                                    href={linkUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="block mb-4 rounded-xl overflow-hidden bg-gray-200 aspect-[2/1] relative cursor-pointer"
                                  >
                                    <AttractionImage 
                                      wikipediaTitle={event.wikipediaTitle} 
                                      fallbackKeyword={event.searchQuery + ' ' + destination} 
                                      alt={event.title} 
                                    />
                                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                                      <ExternalLink className="text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-md" size={32} />
                                    </div>
                                  </a>
                                )}

                                <div className="flex items-center gap-3 mb-3">
                                  <span className={`text-xs font-bold px-2.5 py-1 rounded-lg border ${badgeColorClass}`}>
                                    {event.time}
                                  </span>
                                  <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                                    {typeLabel}
                                  </span>
                                </div>
                                <h4 className="font-bold text-gray-900 text-lg mb-2">{event.title}</h4>
                                <p className="text-sm text-gray-600 leading-relaxed mb-4">{event.description}</p>
                                
                                {/* Action Link */}
                                {(!isTransport || isFlight || isDining) ? (
                                  <a 
                                    href={linkUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className={`inline-flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-lg transition-colors ${
                                      isDining 
                                        ? 'text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100' 
                                        : 'text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100'
                                    }`}
                                  >
                                    {event.officialWebsite ? (isFlight ? <Plane size={14} /> : <Globe size={14} />) : <Search size={14} />}
                                    {event.officialWebsite ? (isFlight ? t.searchFlights : t.officialSite) : t.searchGoogle}
                                  </a>
                                ) : (
                                  event.googleMapsUrl && (
                                    <a 
                                      href={event.googleMapsUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-lg text-emerald-600 hover:text-emerald-700 bg-emerald-50 hover:bg-emerald-100 transition-colors"
                                    >
                                      <Navigation size={14} />
                                      {t.viewOnGoogleMaps}
                                    </a>
                                  )
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )
        })}

          {/* FABs Container */}
            <div className="fixed bottom-8 right-8 z-50 flex flex-col gap-4 items-end">
              {/* Auto-save Indicator */}
              {isSaved && (
                <div className="bg-emerald-500 text-white px-4 py-2 rounded-full text-sm font-bold shadow-lg flex items-center gap-2 animate-in slide-in-from-bottom-2 fade-in">
                  <Check size={16} />
                  {language === 'zh' ? '已自动保存' : 'Auto-saved'}
                </div>
              )}

              {/* Back to Top FAB */}
              {showBackToTop && (
                <button
                  onClick={scrollToTop}
                  className="w-14 h-14 bg-white text-gray-600 rounded-full shadow-lg border border-gray-100 flex items-center justify-center hover:bg-gray-50 transition-all animate-in fade-in zoom-in hover:scale-105 active:scale-95"
                  title={language === 'zh' ? '返回顶部' : 'Back to Top'}
                >
                  <ArrowUp size={24} />
                </button>
              )}

              {/* Collab FAB */}
              {plan && (
                <button
                  onClick={handleCollab}
                  disabled={isSharing}
                  className="w-14 h-14 bg-indigo-600 hover:bg-indigo-700 text-white rounded-full font-bold shadow-lg shadow-indigo-600/20 flex items-center justify-center transition-all hover:scale-105 active:scale-95 animate-in fade-in slide-in-from-bottom-4 disabled:opacity-50 disabled:cursor-not-allowed"
                  title={language === 'zh' ? '邀请共创' : 'Invite Collaborators'}
                >
                  <Users size={24} />
                </button>
              )}

              {/* Generate Budget FAB */}
              {plan && (
                <button
                  onClick={() => navigate('/budget', { 
                    state: { 
                      plan: {
                        origin,
                        destination,
                        days: plan?.days.length || days,
                        peopleCount: Number(peopleCount) || 1,
                        startDate,
                        endDate,
                        selectedFlight: plan?.flightOptions.find(f => f.id === selectedFlightId),
                        itinerary: plan?.days
                      } 
                    } 
                  })}
                  className="w-14 h-14 bg-emerald-600 hover:bg-emerald-700 text-white rounded-full font-bold shadow-lg shadow-emerald-600/20 flex items-center justify-center transition-all hover:scale-105 active:scale-95 animate-in fade-in slide-in-from-bottom-4"
                  title={language === 'zh' ? '生成预算' : 'Generate Budget'}
                >
                  <Receipt size={24} />
                </button>
              )}

              {/* Chat FAB */}
              <button
                onClick={() => setIsChatOpen(true)}
                className="w-14 h-14 bg-purple-600 text-white rounded-full shadow-lg shadow-purple-600/30 flex items-center justify-center hover:bg-purple-700 transition-transform hover:scale-105"
              >
                <MessageSquare size={24} />
              </button>
            </div>

            {/* Chat Window */}
            {isChatOpen && (
              <div className="fixed bottom-28 right-8 z-50 w-80 md:w-96 bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden flex flex-col h-[500px] max-h-[70vh] animate-in slide-in-from-bottom-8 fade-in">
                <div className="bg-purple-600 text-white p-4 flex justify-between items-center">
                  <h3 className="font-bold flex items-center gap-2"><Sparkles size={18}/> {t.chatTitle}</h3>
                  <button onClick={() => setIsChatOpen(false)} className="text-white/80 hover:text-white transition-colors"><X size={20}/></button>
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50">
                  {chatMessages.length === 0 && (
                    <div className="text-center text-gray-500 text-sm mt-4">{t.chatEmpty}</div>
                  )}
                  {chatMessages.map((msg, idx) => (
                    <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[85%] p-3 rounded-2xl text-sm leading-relaxed ${msg.role === 'user' ? 'bg-purple-600 text-white rounded-tr-sm' : 'bg-white border border-gray-200 text-gray-800 rounded-tl-sm shadow-sm'}`}>
                        {msg.text}
                      </div>
                    </div>
                  ))}
                  {isChatLoading && (
                    <div className="flex justify-start">
                      <div className="bg-white border border-gray-200 p-3 rounded-2xl rounded-tl-sm shadow-sm flex items-center gap-2">
                        <Loader2 size={16} className="animate-spin text-purple-600" />
                        <span className="text-sm text-gray-500">{t.replanning}</span>
                      </div>
                    </div>
                  )}
                </div>
                <div className="p-3 bg-white border-t border-gray-100 flex gap-2">
                  <input 
                    type="text" 
                    value={chatInput}
                    onChange={e => setChatInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleSendMessage()}
                    placeholder={t.chatPlaceholder}
                    className="flex-1 bg-gray-100 border-transparent focus:bg-white focus:border-purple-500 focus:ring-2 focus:ring-purple-200 rounded-xl px-4 py-2 text-sm outline-none transition-all"
                  />
                  <button 
                    onClick={handleSendMessage}
                    disabled={!chatInput.trim() || isChatLoading}
                    className="w-10 h-10 bg-purple-600 text-white rounded-xl flex items-center justify-center disabled:opacity-50 hover:bg-purple-700 transition-colors shrink-0"
                  >
                    <Send size={18} />
                  </button>
                </div>
              </div>
            )}

          </div>
        )}

        {/* Share Modal */}
        {shareUrl && (
          <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl animate-in zoom-in-95 duration-200">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-xl font-bold text-gray-900">
                  {language === 'zh' ? '分享链接' : 'Share Link'}
                </h3>
                <button onClick={() => setShareUrl(null)} className="text-gray-400 hover:text-gray-600 transition-colors">
                  <X size={24} />
                </button>
              </div>
              <p className="text-gray-500 mb-4 text-sm">
                {language === 'zh' ? '复制以下链接与朋友分享：' : 'Copy the link below to share with friends:'}
              </p>
              <div className="flex gap-2 mb-6">
                <input 
                  type="text" 
                  readOnly 
                  value={shareUrl} 
                  className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                />
                <button 
                  onClick={() => {
                    navigator.clipboard.writeText(shareUrl).then(() => {
                      setIsCopied(true);
                      setTimeout(() => setIsCopied(false), 2000);
                    }).catch(() => {
                      alert(language === 'zh' ? '复制失败，请手动复制' : 'Failed to copy, please copy manually');
                    });
                  }}
                  className={`px-6 py-3 text-white rounded-xl font-semibold transition-colors shadow-sm ${isCopied ? 'bg-green-500 hover:bg-green-600' : 'bg-blue-600 hover:bg-blue-700'}`}
                >
                  {isCopied ? (language === 'zh' ? '已复制' : 'Copied') : (language === 'zh' ? '复制' : 'Copy')}
                </button>
              </div>
              <button 
                onClick={() => setShareUrl(null)}
                className="w-full px-5 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-semibold transition-colors"
              >
                {language === 'zh' ? '关闭' : 'Close'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
