import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Markdown from 'react-markdown';
import { ArrowLeft, Calendar, MapPin, Plane, Trash2, Map, Hotel, Train, Camera, Globe, Search, ExternalLink, PlaneTakeoff, PlaneLanding, Ticket, Utensils, Bus, Car, Ship, Footprints, MessageSquare, X, Send, Sparkles, Loader2, Receipt, ArrowUp, ChevronDown, ChevronUp, ChevronsUpDown, ChevronsDownUp, Share, Users } from 'lucide-react';
import { GoogleGenAI, Type } from '@google/genai';
import GlobalAuth from '../components/GlobalAuth';
import { auth, db, handleFirestoreError, OperationType } from '../firebase';
import { collection, query, where, getDocs, deleteDoc, doc, updateDoc, onSnapshot, setDoc } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { SavedBudget } from './BudgetPage';

// Initialize Gemini API
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function generateContentWithFallback(params: any) {
  const models = ['gemini-3.1-pro-preview', 'gemini-3-flash-preview', 'gemini-3.1-flash-lite-preview'];
  for (const model of models) {
    try {
      return await ai.models.generateContent({ ...params, model });
    } catch (error: any) {
      const isQuotaError = error.message.includes('429') || error.message.includes('RESOURCE_EXHAUSTED') || error.message.includes('quota');
      if (isQuotaError) {
        console.warn(`Model ${model} exhausted, trying next...`);
        continue;
      }
      throw error;
    }
  }
  throw new Error('All models exhausted');
}

interface TimelineEvent {
  time: string;
  type: 'activity' | 'transportation' | 'dining';
  title: string;
  description: string;
  searchQuery: string;
  officialWebsite: string;
  wikipediaTitle: string;
}

interface Accommodation {
  name: string;
  description: string;
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
  returnDeparture: string;
  returnArrival: string;
  price: string;
  bookingQuery: string;
  outboundTransit?: string;
  outboundCrossDay?: boolean;
  returnTransit?: string;
  returnCrossDay?: boolean;
}

interface SavedPlan {
  id: string;
  firestoreId?: string;
  origin: string;
  destination: string;
  days: number;
  startDate?: string;
  endDate?: string;
  createdAt: string;
  flightOptions?: FlightOption[];
  selectedFlight?: FlightOption;
  itinerary: DayPlan[];
}

const translations = {
  zh: {
    back: '返回首页',
    title: '我的行程',
    subtitle: '查看您保存的所有旅行计划。',
    noPlans: '您还没有保存任何行程。',
    goPlan: '去规划一个',
    delete: '删除',
    days: '天',
    dates: '日期',
    flight: '已选航班',
    train: '已选车次',
    outbound: '去程',
    returnFlight: '返程',
    returnTrain: '返程',
    departure: '起飞',
    trainDeparture: '出发',
    arrival: '降落',
    trainArrival: '到达',
    viewDetails: '查看详情',
    hideDetails: '收起详情',
    accommodation: '住宿安排',
    itinerary: '每日行程',
    activity: '活动',
    transportation: '交通',
    dining: '餐饮',
    officialSite: '访问官网',
    searchGoogle: '在 Google 搜索',
    chatTitle: '调整行程',
    chatPlaceholder: '告诉我想怎么改，比如"把第一天的晚餐换成吃烤鸭"...',
    chatSend: '发送',
    chatEmpty: '有什么想调整的吗？随时告诉我！',
    replanning: '正在重新规划...'
  },
  en: {
    back: 'Back to Home',
    title: 'My Itineraries',
    subtitle: 'View all your saved travel plans.',
    noPlans: 'You have not saved any itineraries yet.',
    goPlan: 'Plan one now',
    delete: 'Delete',
    days: 'Days',
    dates: 'Dates',
    flight: 'Selected Flight',
    train: 'Selected Train',
    outbound: 'Outbound',
    returnFlight: 'Return',
    returnTrain: 'Return',
    departure: 'Departs',
    trainDeparture: 'Departs',
    arrival: 'Arrives',
    trainArrival: 'Arrives',
    viewDetails: 'View Details',
    hideDetails: 'Hide Details',
    accommodation: 'Accommodation',
    itinerary: 'Daily Itinerary',
    activity: 'Activity',
    transportation: 'Transport',
    dining: 'Dining',
    officialSite: 'Official Website',
    searchGoogle: 'Search on Google',
    chatTitle: 'Modify Itinerary',
    chatPlaceholder: 'Tell me what to change, e.g., "Change day 1 dinner to pizza"...',
    chatSend: 'Send',
    chatEmpty: 'Want to make any changes? Let me know!',
    replanning: 'Re-planning...'
  }
};

const getTransportIcon = (title: string, desc: string) => {
  const text = (title + ' ' + desc).toLowerCase();
  if (text.includes('✈️') || text.includes('flight') || text.includes('plane') || text.includes('airport') || text.includes('飞机') || text.includes('航班') || text.includes('机场')) return Plane;
  if (text.includes('bus') || text.includes('coach') || text.includes('巴士') || text.includes('公交') || text.includes('大巴')) return Bus;
  if (text.includes('taxi') || text.includes('car') || text.includes('drive') || text.includes('uber') || text.includes('出租车') || text.includes('打车') || text.includes('自驾') || text.includes('汽车')) return Car;
  if (text.includes('boat') || text.includes('ship') || text.includes('ferry') || text.includes('cruise') || text.includes('船') || text.includes('渡轮') || text.includes('游轮')) return Ship;
  if (text.includes('walk') || text.includes('foot') || text.includes('hike') || text.includes('步行') || text.includes('走路') || text.includes('徒步')) return Footprints;
  return Train; // Default transport icon
};

// Reusing the AttractionImage component
function AttractionImage({ wikipediaTitle, fallbackKeyword, alt }: { wikipediaTitle: string, fallbackKeyword: string, alt: string }) {
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!wikipediaTitle) {
      setError(true);
      return;
    }
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

export default function MyPlansPage() {
  const navigate = useNavigate();
  const [language, setLanguage] = useState<'zh' | 'en'>('zh');
  const [error, setError] = useState<string | null>(null);
  const [isDeleted, setIsDeleted] = useState(false);
  const [planToDelete, setPlanToDelete] = useState<SavedPlan | null>(null);
  const [plans, setPlans] = useState<SavedPlan[]>([]);
  const [savedBudgets, setSavedBudgets] = useState<SavedBudget[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedPlanIds, setExpandedPlanIds] = useState<string[]>([]);
  const [collapsedDays, setCollapsedDays] = useState<number[]>([]);
  const [showBackToTop, setShowBackToTop] = useState(false);

  const toggleDayCollapse = (dayNumber: number) => {
    setCollapsedDays(prev => 
      prev.includes(dayNumber) 
        ? prev.filter(d => d !== dayNumber) 
        : [...prev, dayNumber]
    );
  };

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

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Chat State
  const [activeChatPlanId, setActiveChatPlanId] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState<{role: 'user' | 'ai', text: string}[]>([]);
  const [isChatLoading, setIsChatLoading] = useState(false);

  const t = (translations as any)[language];

  useEffect(() => {
    let unsubscribe: () => void = () => {};

    const authUnsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        // Clear local storage when user logs in to avoid duplicates
        localStorage.removeItem('saved_travel_plans');
        
        const q = query(collection(db, 'users', user.uid, 'plans'));
        unsubscribe = onSnapshot(q, (snapshot) => {
          const cloudPlans = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
              ...JSON.parse(data.data),
              firestoreId: doc.id
            };
          });
          const uniquePlans = cloudPlans.filter((item, index, self) =>
            index === self.findIndex((t) => t.id === item.id)
          );
          setPlans(uniquePlans.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
          setIsLoading(false);
        }, (error) => {
          handleFirestoreError(error, OperationType.LIST, `users/${user.uid}/plans`);
          setIsLoading(false);
        });

        const bq = query(collection(db, 'users', user.uid, 'budgets'));
        onSnapshot(bq, (snapshot) => {
          const cloudBudgets = snapshot.docs.map(doc => ({
            ...JSON.parse(doc.data().data),
            firestoreId: doc.id
          }));
          setSavedBudgets(cloudBudgets);
        });
      } else {
        const saved = JSON.parse(localStorage.getItem('saved_travel_plans') || '[]');
        const uniqueSaved = saved.filter((item: any, index: number, self: any[]) =>
          index === self.findIndex((t) => t.id === item.id)
        );
        setPlans(uniqueSaved.sort((a: SavedPlan, b: SavedPlan) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
        
        const savedBudgetsLocal = JSON.parse(localStorage.getItem('saved_budgets') || '[]');
        setSavedBudgets(savedBudgetsLocal);
        setIsLoading(false);
      }
    });

    return () => {
      authUnsubscribe();
      unsubscribe();
    };
  }, []);

  const [sharingId, setSharingId] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [isCopied, setIsCopied] = useState(false);

  const handleCollabPlan = async (plan: SavedPlan, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!auth.currentUser) {
      alert(language === 'zh' ? '请先登录以邀请共创' : 'Please log in to invite collaborators');
      return;
    }
    
    if (!plan.firestoreId) {
      alert(language === 'zh' ? '请先保存行程' : 'Please save the itinerary first');
      return;
    }

    setSharingId(plan.id);
    try {
      const docRef = doc(db, 'users', auth.currentUser.uid, 'plans', plan.firestoreId);
      await updateDoc(docRef, {
        isPublicEdit: true
      });

      const url = `${window.location.origin}/collab/plan/${auth.currentUser.uid}/${plan.firestoreId}`;
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
      setSharingId(null);
    }
  };

  const handleCollabBudget = async (budget: SavedBudget, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!auth.currentUser) {
      alert(language === 'zh' ? '请先登录以邀请共创' : 'Please log in to invite collaborators');
      return;
    }
    
    if (!budget.firestoreId) {
      alert(language === 'zh' ? '请先保存账单' : 'Please save the budget first');
      return;
    }

    setSharingId(budget.id);
    try {
      const docRef = doc(db, 'users', auth.currentUser.uid, 'budgets', budget.firestoreId);
      await updateDoc(docRef, {
        isPublicEdit: true
      });

      const url = `${window.location.origin}/collab/budget/${auth.currentUser.uid}/${budget.firestoreId}`;
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
      setSharingId(null);
    }
  };

  const handleSharePlan = async (plan: SavedPlan, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!auth.currentUser) {
      alert(language === 'zh' ? '请先登录以分享行程' : 'Please log in to share the itinerary');
      return;
    }
    
    setSharingId(plan.id);
    try {
      const planToShare = {
        origin: plan.origin,
        destination: plan.destination,
        days: plan.days,
        peopleCount: 1, // Default or find from plan if available
        startDate: plan.startDate,
        endDate: plan.endDate,
        flightOptions: plan.flightOptions,
        selectedFlightId: plan.selectedFlight?.id,
        selectedFlight: plan.selectedFlight,
        itinerary: plan.itinerary
      };

      const shareRef = doc(collection(db, 'shared_items'));
      await setDoc(shareRef, {
        type: 'plan',
        data: JSON.stringify(planToShare),
        ownerId: auth.currentUser.uid,
        createdAt: new Date().toISOString()
      });

      const url = `${window.location.origin}/shared/${shareRef.id}`;
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
      console.error("Error sharing:", error);
      alert(language === 'zh' ? '分享失败，请重试' : 'Failed to share, please try again');
    } finally {
      setSharingId(null);
    }
  };

  const handleShareBudget = async (budget: SavedBudget, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!auth.currentUser) {
      alert(language === 'zh' ? '请先登录以分享账单' : 'Please log in to share the budget');
      return;
    }
    
    setSharingId(budget.id);
    try {
      const budgetToShare = {
        destination: budget.destination,
        days: budget.days,
        data: budget.data
      };

      const shareRef = doc(collection(db, 'shared_items'));
      await setDoc(shareRef, {
        type: 'budget',
        data: JSON.stringify(budgetToShare),
        ownerId: auth.currentUser.uid,
        createdAt: new Date().toISOString()
      });

      const url = `${window.location.origin}/shared/${shareRef.id}`;
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
      console.error("Error sharing:", error);
      alert(language === 'zh' ? '分享失败，请重试' : 'Failed to share, please try again');
    } finally {
      setSharingId(null);
    }
  };

  const handleDelete = (plan: SavedPlan, e: React.MouseEvent) => {
    e.stopPropagation();
    setPlanToDelete(plan);
  };

  const confirmDelete = async () => {
    if (!planToDelete) return;
    const { id, firestoreId } = planToDelete;
    
    // Close modal immediately
    setPlanToDelete(null);
    
    setError(null);
    
    if (auth.currentUser && firestoreId) {
      try {
        await deleteDoc(doc(db, 'users', auth.currentUser.uid, 'plans', firestoreId));
        // Optimistically update local state after successful cloud delete
        const updated = plans.filter(p => p.id !== id);
        setPlans(updated);
      } catch (error) {
        console.error(error);
        setError(language === 'zh' ? '删除失败，请重试。' : 'Failed to delete, please try again.');
        handleFirestoreError(error, OperationType.DELETE, `users/${auth.currentUser.uid}/plans/${firestoreId}`);
        return;
      }
    } else {
      const updated = plans.filter(p => p.id !== id);
      setPlans(updated);
      localStorage.setItem('saved_travel_plans', JSON.stringify(updated));
    }

    setIsDeleted(true);
    setTimeout(() => setIsDeleted(false), 3000);

    setExpandedPlanIds(prev => prev.filter(pid => pid !== id));
    if (activeChatPlanId === id) {
      setActiveChatPlanId(null);
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedPlanIds(prev => 
      prev.includes(id) ? [] : [id]
    );
    if (activeChatPlanId === id) {
      setActiveChatPlanId(null);
    }
  };

  const handleSendMessage = async () => {
    if (!chatInput.trim() || isChatLoading || !activeChatPlanId) return;

    const currentPlan = plans.find(p => p.id === activeChatPlanId);
    if (!currentPlan) return;

    const userMsg = chatInput.trim();
    setChatInput('');
    setChatMessages(prev => [...prev, { role: 'user', text: userMsg }]);
    setIsChatLoading(true);

    try {
      const responseSchema = {
        type: Type.OBJECT,
        properties: {
          thinking: { type: Type.STRING, description: "The AI's reasoning process for the requested itinerary or flight modifications." },
          itinerary: {
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
                    description: { type: Type.STRING }
                  },
                  required: ["name", "description"]
                },
                events: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      time: { type: Type.STRING },
                      type: { type: Type.STRING, description: "Must be exactly 'activity', 'transportation', or 'dining'" },
                      title: { type: Type.STRING },
                      description: { type: Type.STRING },
                      searchQuery: { type: Type.STRING },
                      officialWebsite: { type: Type.STRING },
                      wikipediaTitle: { type: Type.STRING }
                    },
                    required: ["time", "type", "title", "description", "searchQuery", "officialWebsite", "wikipediaTitle"]
                  }
                }
              },
              required: ["dayNumber", "theme", "accommodation", "events"]
            }
          },
          selectedFlight: {
            type: Type.OBJECT,
            description: "Updated flight details if the user requested a flight change.",
            properties: {
              id: { type: Type.STRING },
              airline: { type: Type.STRING },
              price: { type: Type.STRING },
              tag: { type: Type.STRING },
              outboundDeparture: { type: Type.STRING },
              outboundArrival: { type: Type.STRING },
              outboundTransit: { type: Type.STRING },
              outboundCrossDay: { type: Type.STRING },
              returnDeparture: { type: Type.STRING },
              returnArrival: { type: Type.STRING },
              returnTransit: { type: Type.STRING },
              returnCrossDay: { type: Type.STRING }
            },
            required: ["id", "airline", "price", "tag", "outboundDeparture", "outboundArrival", "returnDeparture", "returnArrival"]
          }
        },
        required: ["thinking", "itinerary"]
      };

      const prompt = `
        You are an expert travel planner. The user wants to modify their existing itinerary or flight selection.
        
        Current Itinerary JSON:
        ${JSON.stringify(currentPlan.itinerary, null, 2)}
        
        Current Flight JSON:
        ${JSON.stringify(currentPlan.selectedFlight || {}, null, 2)}
        
        User's Modification Request: "${userMsg}"
        Language: ${language === 'zh' ? 'Chinese (Simplified)' : 'English'}
        
        Instructions:
        1. First, provide your reasoning process in the 'thinking' field. Explain how you plan to modify the itinerary or flight based on the user's request.
        2. If the user requests a flight change, provide the updated flight details in the 'selectedFlight' field. If no flight change is requested, omit 'selectedFlight'.
        3. Then, modify the itinerary JSON accordingly in the 'itinerary' field.
        4. Keep the same number of days unless the user explicitly asks to add/remove days.
        5. Ensure the output strictly follows the provided JSON schema.
        6. For new events, provide realistic times, titles, descriptions, and search queries.
        7. If the user asks to change a meal, ensure the type is "dining".
      `;

      const response = await generateContentWithFallback({
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: responseSchema,
          temperature: 0.2,
        }
      });

      const jsonStr = response.text?.trim() || '{"thinking": "", "itinerary": []}';
      const result = JSON.parse(jsonStr) as { thinking: string, itinerary: DayPlan[], selectedFlight?: any };
      const updatedDays = result.itinerary;
      const updatedFlight = result.selectedFlight;
      const thinking = result.thinking;

      if (updatedDays && updatedDays.length > 0) {
        // Update Firestore if it's a saved plan
        const planToUpdate = plans.find(p => p.id === activeChatPlanId);
        console.log('Plan to update in Firestore:', planToUpdate);
        if (auth.currentUser && planToUpdate && (planToUpdate as any).firestoreId) {
          try {
            const updatedPlanData = {
              ...planToUpdate,
              itinerary: updatedDays,
              ...(updatedFlight ? { selectedFlight: updatedFlight } : {})
            };
            
            // Determine the correct user ID to save to (handle collaborative plans)
            const isCollab = (planToUpdate as any).isPublicEdit;
            // In MyPlansPage, we only list plans owned by the current user or local plans.
            // If it's a collab plan, the current user is the owner in this context.
            // Wait, if it's a collab plan, they might be editing someone else's plan?
            // Actually, MyPlansPage only shows plans from `users/${user.uid}/plans`.
            // So the owner is always `auth.currentUser.uid`.
            const userIdToSave = auth.currentUser.uid;
            
            // We need to update the 'data' field which contains the serialized JSON
            await updateDoc(doc(db, 'users', userIdToSave, 'plans', (planToUpdate as any).firestoreId), {
              data: JSON.stringify(updatedPlanData),
              // Also update top-level fields if they exist in the schema
              itinerary: updatedDays,
              ...(updatedFlight ? { selectedFlight: updatedFlight } : {})
            });
            console.log('Firestore update successful');
          } catch (error) {
            console.error("Firestore update failed:", error);
          }
        } else {
            // Fallback for local-only plans
            const updatedPlans = plans.map(p => {
              if (p.id === activeChatPlanId) {
                return { 
                  ...p, 
                  itinerary: updatedDays,
                  ...(updatedFlight ? { selectedFlight: updatedFlight } : {})
                };
              }
              return p;
            });
            setPlans(updatedPlans);
            localStorage.setItem('saved_travel_plans', JSON.stringify(updatedPlans));
        }

        setChatMessages(prev => [...prev, { 
          role: 'ai', 
          text: `${thinking}\n\n---\n\n${language === 'zh' ? '行程已更新并自动保存！请查看左侧最新的时间轴。' : 'Itinerary updated and saved! Check the timeline on the left.'}`
        }]);
      } else {
        throw new Error("Invalid response format");
      }
    } catch (error: any) {
      console.error("Chat update failed:", error);
      
      let errorMessage = language === 'zh' ? '抱歉，更新行程失败，请重试。' : 'Sorry, failed to update itinerary. Please try again.';
      
      // Check for quota error (429)
      if (error?.status === 429 || (error?.message && error.message.includes('429'))) {
        errorMessage = language === 'zh' 
          ? '抱歉，AI 额度已用尽，请稍后再试。' 
          : 'Sorry, AI quota exceeded. Please try again later.';
      }

      setChatMessages(prev => [...prev, { 
        role: 'ai', 
        text: errorMessage
      }]);
    } finally {
      setIsChatLoading(false);
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
          
          {/* Language Toggle */}
          <div className="flex items-center gap-4">
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
        
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 tracking-tight flex items-center gap-3">
            <Map className="text-blue-500" size={32} />
            {t.title}
          </h1>
          <p className="text-gray-500 mt-2 text-lg">{t.subtitle}</p>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 text-red-700 rounded-xl border border-red-100 font-medium">
            {error}
          </div>
        )}

        {isDeleted && (
          <div className="mb-6 p-4 bg-emerald-50 text-emerald-700 rounded-xl border border-emerald-100 font-medium">
            {language === 'zh' ? '删除成功' : 'Deleted successfully'}
          </div>
        )}

        {isLoading ? (
          <div className="flex justify-center items-center p-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
          </div>
        ) : plans.length === 0 ? (
          <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-12 text-center">
            <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <MapPin className="text-gray-300" size={32} />
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-2">{t.noPlans}</h3>
            <button 
              onClick={() => navigate('/plan')}
              className="mt-4 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold transition-colors"
            >
              {t.goPlan}
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            {plans.map((plan, index) => {
              const isExpanded = expandedPlanIds.includes(plan.id);
              const uniqueKey = plan.firestoreId || `${plan.id}-${index}`;
              return (
              <div key={uniqueKey} className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden transition-all">
                {/* Plan Summary Card */}
                <div 
                  className="p-6 md:p-8 cursor-pointer hover:bg-gray-50 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-6"
                  onClick={() => {
                    console.log('Plan clicked:', plan);
                    toggleExpand(plan.id);
                  }}
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-3">
                      <span className="px-3 py-1 bg-blue-100 text-blue-700 text-sm font-bold rounded-lg">
                        {plan.days} {t.days}
                      </span>
                      <span className="text-sm text-gray-500 font-medium">
                        {new Date(plan.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                    <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
                      {plan.origin} <ArrowLeft size={20} className="rotate-180 text-gray-400" /> {plan.destination}
                    </h2>
                    {(plan.startDate || plan.endDate) && (
                      <div className="flex items-center gap-2 mt-3 text-gray-600 text-sm font-medium">
                        <Calendar size={16} className="text-emerald-500" />
                        {plan.startDate ? plan.startDate : '...'} - {plan.endDate ? plan.endDate : '...'}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-4">
                    <button 
                      onClick={(e) => handleSharePlan(plan, e)}
                      disabled={sharingId === plan.id}
                      className="p-2.5 text-blue-500 hover:bg-blue-50 rounded-xl transition-colors disabled:opacity-50"
                      title={language === 'zh' ? '分享' : 'Share'}
                    >
                      {sharingId === plan.id ? <Loader2 size={20} className="animate-spin" /> : <Share size={20} />}
                    </button>
                    <button 
                      className="px-5 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-semibold text-sm transition-colors"
                    >
                      {isExpanded ? t.hideDetails : t.viewDetails}
                    </button>
                    <button 
                      onClick={(e) => handleDelete(plan, e)}
                      className="p-2.5 text-red-500 hover:bg-red-50 rounded-xl transition-colors"
                      title={t.delete}
                    >
                      <Trash2 size={20} />
                    </button>
                  </div>
                </div>

                {/* Confirmation Modal */}
                {planToDelete && (
                  <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-3xl p-8 max-w-sm w-full shadow-2xl">
                      <h3 className="text-xl font-bold text-gray-900 mb-4">
                        {language === 'zh' ? '确定删除行程？' : 'Delete itinerary?'}
                      </h3>
                      <p className="text-gray-500 mb-8">
                        {language === 'zh' ? '此操作不可撤销。' : 'This action cannot be undone.'}
                      </p>
                      <div className="flex gap-4">
                        <button 
                          onClick={() => setPlanToDelete(null)}
                          className="flex-1 px-5 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-semibold transition-colors"
                        >
                          {language === 'zh' ? '取消' : 'Cancel'}
                        </button>
                        <button 
                          onClick={confirmDelete}
                          className="flex-1 px-5 py-3 bg-red-500 hover:bg-red-600 text-white rounded-xl font-semibold transition-colors"
                        >
                          {language === 'zh' ? '删除' : 'Delete'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Expanded Details */}
                {isExpanded && (
                  <div className="border-t border-gray-100 bg-gray-50/50 p-6 md:p-8 animate-in slide-in-from-top-4 fade-in duration-300">
                    
                    {/* Selected Flight */}
                    {plan.selectedFlight && (
                      <div className="mb-10 bg-white p-6 rounded-2xl border border-blue-100 shadow-sm relative overflow-hidden">
                        <div className="absolute top-0 right-0 p-6 opacity-5 pointer-events-none">
                          {plan.selectedFlight.type === 'train' ? (
                            <Train size={80} className="rotate-12" />
                          ) : (
                            <Plane size={80} className="rotate-45" />
                          )}
                        </div>
                        <div className="flex flex-col md:flex-row md:items-center justify-between mb-4 gap-4">
                          <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                            {plan.selectedFlight.type === 'train' ? (
                              <>
                                <Train className="text-blue-500" size={20} />
                                {t.train}
                              </>
                            ) : (
                              <>
                                <Ticket className="text-blue-500" size={20} />
                                {t.flight}
                              </>
                            )}
                          </h3>
                          <button 
                            onClick={() => navigate('/flights', { state: { origin: plan.origin, destination: plan.destination, startDate: plan.startDate } })}
                            className="flex text-xs flex-shrink-0 items-center justify-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors font-medium border border-blue-100/50 relative z-10"
                          >
                            {language === 'zh' ? '重新选择航班/车次' : 'Select Other Transport'}
                            <ExternalLink size={14} />
                          </button>
                        </div>
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
                          <div>
                            <div className="inline-block px-3 py-1 bg-blue-100 text-blue-700 text-xs font-bold rounded-lg mb-2">
                              {plan.selectedFlight.tag}
                            </div>
                            <div className="font-bold text-gray-900">{plan.selectedFlight.airline}</div>
                          </div>
                          <div className="flex gap-6">
                            <div>
                              <div className="text-xs text-gray-500 uppercase font-semibold mb-1">{t.outbound}</div>
                              <div className="flex items-center gap-3 bg-gray-50 p-2 rounded-lg">
                                <div className="text-center">
                                  <div className="text-sm font-bold text-gray-900">{plan.selectedFlight.outboundDeparture}</div>
                                  <div className="text-[10px] text-gray-500">{plan.selectedFlight.type === 'train' ? t.trainDeparture : t.departure}</div>
                                </div>
                                <div className="flex flex-col items-center justify-center px-2">
                                  <span className="text-[9px] text-gray-500 font-medium mb-1 whitespace-nowrap">{plan.selectedFlight.outboundTransit}</span>
                                  <div className="h-px bg-gray-300 w-full relative min-w-[40px]">
                                    {plan.selectedFlight.type === 'train' ? (
                                      <Train size={12} className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-gray-400 bg-gray-50 px-0.5" />
                                    ) : (
                                      <PlaneTakeoff size={12} className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-gray-400 bg-gray-50 px-0.5" />
                                    )}
                                  </div>
                                </div>
                                <div className="text-center">
                                  <div className="text-sm font-bold text-gray-900">
                                    {plan.selectedFlight.outboundArrival}
                                    {plan.selectedFlight.outboundCrossDay && <span className="text-[10px] text-red-500 ml-0.5 align-top">{plan.selectedFlight.outboundCrossDay}</span>}
                                  </div>
                                  <div className="text-[10px] text-gray-500">{plan.selectedFlight.type === 'train' ? t.trainArrival : t.arrival}</div>
                                </div>
                              </div>
                            </div>
                            <div>
                              <div className="text-xs text-gray-500 uppercase font-semibold mb-1">{plan.selectedFlight.type === 'train' ? t.returnTrain : t.returnFlight}</div>
                              <div className="flex items-center gap-3 bg-gray-50 p-2 rounded-lg">
                                <div className="text-center">
                                  <div className="text-sm font-bold text-gray-900">{plan.selectedFlight.returnDeparture}</div>
                                  <div className="text-[10px] text-gray-500">{plan.selectedFlight.type === 'train' ? t.trainDeparture : t.departure}</div>
                                </div>
                                <div className="flex flex-col items-center justify-center px-2">
                                  <span className="text-[9px] text-gray-500 font-medium mb-1 whitespace-nowrap">{plan.selectedFlight.returnTransit}</span>
                                  <div className="h-px bg-gray-300 w-full relative min-w-[40px]">
                                    {plan.selectedFlight.type === 'train' ? (
                                      <Train size={12} className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-gray-400 bg-gray-50 px-0.5" />
                                    ) : (
                                      <PlaneLanding size={12} className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-gray-400 bg-gray-50 px-0.5" />
                                    )}
                                  </div>
                                </div>
                                <div className="text-center">
                                  <div className="text-sm font-bold text-gray-900">
                                    {plan.selectedFlight.returnArrival}
                                    {plan.selectedFlight.returnCrossDay && <span className="text-[10px] text-red-500 ml-0.5 align-top">{plan.selectedFlight.returnCrossDay}</span>}
                                  </div>
                                  <div className="text-[10px] text-gray-500">{plan.selectedFlight.type === 'train' ? t.trainArrival : t.arrival}</div>
                                </div>
                              </div>
                            </div>
                          </div>
                          <div className="font-bold text-xl text-gray-900">
                            {plan.selectedFlight.price}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Itinerary */}
                    <div className="space-y-12">
                      <div className="flex items-center justify-between mb-6">
                        <h3 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                          <Calendar className="text-blue-500" size={24} />
                          {t.itinerary}
                        </h3>
                        <div className="flex gap-2">
                          <button 
                            onClick={() => setCollapsedDays([])}
                            className="text-sm font-medium text-blue-600 hover:text-blue-700 bg-blue-50 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5"
                          >
                            <ChevronsUpDown size={14} />
                            {language === 'zh' ? '全部展开' : 'Expand All'}
                          </button>
                          <button 
                            onClick={() => setCollapsedDays(plan.itinerary.map(d => d.dayNumber))}
                            className="text-sm font-medium text-gray-600 hover:text-gray-700 bg-gray-100 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5"
                          >
                            <ChevronsDownUp size={14} />
                            {language === 'zh' ? '全部折叠' : 'Collapse All'}
                          </button>
                        </div>
                      </div>

                      {plan.itinerary.map((day) => {
                        const selectedFlight = plan.selectedFlight;
                        let displayEvents = [...day.events];
                        const isCollapsed = collapsedDays.includes(day.dayNumber);
                        
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
                              wikipediaTitle: ''
                            });
                          }
                          if (day.dayNumber === plan.itinerary.length) {
                            displayEvents.push({
                              time: `${selectedFlight.returnDeparture} - ${selectedFlight.returnArrival} ${selectedFlight.returnCrossDay}`.trim(),
                              type: 'transportation',
                              title: `${selectedFlight.type === 'train' ? '🚆' : '✈️'} ${selectedFlight.type === 'train' ? t.returnTrain : t.returnFlight} - ${selectedFlight.airline}`,
                              description: `${selectedFlight.tag} option. Transit: ${selectedFlight.returnTransit}. Price: ${selectedFlight.price}`,
                              searchQuery: selectedFlight.bookingQuery,
                              officialWebsite: selectedFlight.type === 'train' 
                                ? `https://www.google.com/search?q=${encodeURIComponent(selectedFlight.bookingQuery)}`
                                : `https://www.google.com/travel/flights?q=${encodeURIComponent(selectedFlight.bookingQuery)}`,
                              wikipediaTitle: ''
                            });
                          }
                        }

                        return (
                        <div key={day.dayNumber} className="relative">
                          <div 
                            className="flex items-center justify-between mb-6 cursor-pointer group"
                            onClick={() => toggleDayCollapse(day.dayNumber)}
                          >
                            <div className="flex items-center gap-4">
                              <div className="bg-blue-600 text-white w-12 h-12 rounded-2xl flex items-center justify-center font-bold text-xl shadow-sm shadow-blue-600/20 shrink-0">
                                {day.dayNumber}
                              </div>
                              <div>
                                <h3 className="text-xl font-bold text-gray-900 group-hover:text-blue-600 transition-colors">{day.theme}</h3>
                                {plan.startDate && (
                                  <p className="text-sm text-gray-500 font-medium">
                                    {(() => {
                                      const date = new Date(plan.startDate);
                                      date.setDate(date.getDate() + day.dayNumber - 1);
                                      return date.toLocaleDateString();
                                    })()}
                                  </p>
                                )}
                              </div>
                            </div>
                            <div className={`p-2 rounded-xl transition-all ${isCollapsed ? 'bg-gray-100 text-gray-400' : 'bg-blue-100 text-blue-600 rotate-180'}`}>
                              <ChevronDown size={20} />
                            </div>
                          </div>
                          
                          {!isCollapsed && (
                            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 animate-in slide-in-from-top-2 fade-in duration-200">
                              {/* Left Column: Accommodation */}
                              <div className="lg:col-span-4">
                                <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
                                  <div className="flex items-center gap-2 text-purple-600 mb-3">
                                    <Hotel size={18} />
                                    <h4 className="font-bold text-gray-900 text-sm">{t.accommodation}</h4>
                                  </div>
                                  <p className="font-semibold text-gray-900">{day.accommodation.name}</p>
                                  <p className="text-sm text-gray-500 mt-1 leading-relaxed">{day.accommodation.description}</p>
                                </div>
                              </div>

                              {/* Right Column: Events */}
                              <div className="lg:col-span-8">
                                <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm">
                                  <div className="space-y-6 relative before:absolute before:inset-0 before:ml-4 before:-translate-x-px before:h-full before:w-0.5 before:bg-gradient-to-b before:from-gray-200 before:to-transparent">
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
                                    const typeLabel = isFlight ? t.flight : 
                                                      (isTransport ? t.transportation : 
                                                      (isDining ? t.dining : t.activity));
                                    const linkUrl = event.officialWebsite || `https://www.google.com/search?q=${encodeURIComponent(event.searchQuery)}`;
                                    
                                    return (
                                      <div key={i} className="relative flex items-start gap-5 group">
                                        <div className={`flex items-center justify-center w-8 h-8 rounded-full border-4 shadow-sm shrink-0 z-10 mt-1 ${iconColorClass}`}>
                                          <Icon size={14} />
                                        </div>
                                        
                                        <div className="flex-1 p-4 rounded-xl bg-gray-50 border border-gray-100">
                                          {(!isTransport && !isDining) && (
                                            <a 
                                              href={linkUrl}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className="block mb-3 rounded-lg overflow-hidden bg-gray-200 aspect-[2/1] relative cursor-pointer"
                                            >
                                              <AttractionImage 
                                                wikipediaTitle={event.wikipediaTitle} 
                                                fallbackKeyword={event.searchQuery + ' ' + plan.destination} 
                                                alt={event.title} 
                                              />
                                            </a>
                                          )}

                                          <div className="flex items-center gap-2 mb-2">
                                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${badgeColorClass}`}>
                                              {event.time}
                                            </span>
                                            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                                              {typeLabel}
                                            </span>
                                          </div>
                                          <h5 className="font-bold text-gray-900 mb-1">{event.title}</h5>
                                          <p className="text-sm text-gray-600 leading-relaxed mb-3">{event.description}</p>
                                          
                                          {(!isTransport || isFlight || isDining) && (
                                            <a 
                                              href={linkUrl}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-md transition-colors ${
                                                isDining 
                                                  ? 'text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100' 
                                                  : 'text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100'
                                              }`}
                                            >
                                              {event.officialWebsite ? (isFlight ? <Plane size={12} /> : <Globe size={12} />) : <Search size={12} />}
                                              {event.officialWebsite ? (isFlight ? t.searchGoogle : t.officialSite) : t.searchGoogle}
                                            </a>
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
                      );
                    })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          </div>
        )}

        {/* Global FABs Container */}
        <div className="fixed bottom-8 right-8 z-50 flex flex-col gap-4 items-end">
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

          {/* Plan-specific FABs */}
          {expandedPlanIds.length > 0 && !activeChatPlanId && (
            <div className="flex flex-col gap-3 items-end">
              <button 
                onClick={() => { 
                  const planId = expandedPlanIds[0];
                  setActiveChatPlanId(planId); 
                  setChatMessages([]); 
                }}
                className="w-14 h-14 bg-purple-600 hover:bg-purple-700 text-white rounded-full shadow-lg transition-all flex items-center justify-center hover:scale-105 active:scale-95"
                title={t.chatTitle}
              >
                <Sparkles size={24} />
              </button>
              <button 
                onClick={() => {
                  const plan = plans.find(p => p.id === expandedPlanIds[0]);
                  if (plan) navigate('/budget', { state: { plan } });
                }}
                className="w-14 h-14 bg-emerald-600 hover:bg-emerald-700 text-white rounded-full shadow-lg transition-all flex items-center justify-center hover:scale-105 active:scale-95"
                title={language === 'zh' ? '生成预算' : 'Generate Budget'}
              >
                <Receipt size={24} />
              </button>
              <button
                onClick={(e) => {
                  const plan = plans.find(p => p.id === expandedPlanIds[0]);
                  if (plan) handleCollabPlan(plan, e);
                }}
                className="w-14 h-14 bg-indigo-600 hover:bg-indigo-700 text-white rounded-full shadow-lg transition-all flex items-center justify-center hover:scale-105 active:scale-95"
                title={language === 'zh' ? '邀请共创' : 'Invite Collaborators'}
              >
                <Users size={24} />
              </button>
            </div>
          )}
        </div>

        {/* Chat Window */}
        {activeChatPlanId && (
          <div className="fixed bottom-8 right-8 z-50 w-80 md:w-96 bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden flex flex-col h-[500px] max-h-[70vh] animate-in slide-in-from-bottom-8 fade-in">
            <div className="bg-purple-600 text-white p-4 flex justify-between items-center">
              <h3 className="font-bold flex items-center gap-2"><Sparkles size={18}/> {t.chatTitle}</h3>
              <button onClick={() => setActiveChatPlanId(null)} className="text-white/80 hover:text-white transition-colors"><X size={20}/></button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50">
              {chatMessages.length === 0 && (
                <div className="text-center text-gray-500 text-sm mt-4">{t.chatEmpty}</div>
              )}
              {chatMessages.map((msg, idx) => (
                <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] p-3 rounded-2xl text-sm leading-relaxed ${msg.role === 'user' ? 'bg-purple-600 text-white rounded-tr-sm' : 'bg-white border border-gray-200 text-gray-800 rounded-tl-sm shadow-sm'}`}>
                    <div className="prose prose-sm max-w-none">
                      <Markdown>{msg.text}</Markdown>
                    </div>
                  </div>
                </div>
              ))}
              {isChatLoading && (
                <div className="flex justify-start">
                  <div className="bg-white border border-gray-200 p-3 rounded-2xl rounded-tl-sm shadow-sm flex items-center gap-2">
                    <Loader2 size={16} className="animate-spin text-purple-600" />
                    <span className="text-sm text-gray-500 font-medium">
                      {language === 'zh' ? '正在思考...' : 'Thinking...'}
                    </span>
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
