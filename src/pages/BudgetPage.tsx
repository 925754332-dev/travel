import { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, PieChart as PieChartIcon, Receipt, Loader2, DollarSign, AlertCircle, Save, Check, Trash2, MapPin, Edit2, MessageSquare, Sparkles, X, Send, ArrowUp, Upload, Share, Users, Plus } from 'lucide-react';
import { GoogleGenAI, Type } from '@google/genai';
import GlobalAuth from '../components/GlobalAuth';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import * as XLSX from 'xlsx';
import { auth, db, handleFirestoreError, OperationType } from '../firebase';
import { collection, query, where, getDocs, deleteDoc, doc, setDoc, updateDoc, onSnapshot } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function generateContentWithFallback(params: any) {
  const models = ['gemini-3-flash-preview', 'gemini-3.1-pro-preview', 'gemini-3.1-flash-lite-preview'];
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

export interface BudgetCategory {
  name: string;
  amount: number;
  color: string;
}

export interface BudgetLineItem {
  dayNumber: number;
  title: string;
  category: string;
  amount: number;
  unitPrice: number;
  quantity: number;
  isPerPerson: boolean;
  isAccommodation?: boolean;
  notes?: string;
}

export interface BudgetData {
  currency: string;
  currencySymbol: string;
  totalAmount: number;
  peopleCount: number;
  categories: BudgetCategory[];
  lineItems: BudgetLineItem[];
}

export interface SavedBudget {
  id: string;
  firestoreId?: string;
  destination: string;
  days: number;
  createdAt: string;
  data: BudgetData;
}

const translations = {
  zh: {
    back: '返回',
    title: '行程预算预估',
    subtitle: '基于您的行程安排，AI 为您生成的预估账单。',
    generating: '正在为您精打细算，生成预算清单...',
    error: '生成预算失败，请重试。',
    total: '总计预估',
    breakdown: '费用分布',
    details: '详细账单',
    day: '第',
    daySuffix: '天',
    noPlan: '未找到行程数据，请先生成行程。',
    tableDay: '日期',
    tableCategory: '类别',
    tableItem: '项目',
    tableAmount: '金额',
    tableNotes: '备注',
    myBudgets: '我的账单',
    saveBudget: '保存账单',
    savedSuccess: '保存成功',
    autoSaved: '已自动保存',
    noBudgets: '暂无保存的账单',
    viewDetails: '查看详情',
    delete: '删除',
    destination: '目的地',
    peopleCount: '出行人数',
    unitPrice: '单价',
    quantity: '数量',
    isPerPerson: '按人计费',
    edit: '编辑',
    done: '完成',
    addItem: '添加项目',
    recalculateAI: 'AI 重新计算',
    recalculating: 'AI 正在重新计算...',
    chatTitle: '调整预算',
    chatPlaceholder: '告诉我想怎么改，比如"调低餐饮预算"或"增加住宿天数"...',
    chatSend: '发送',
    chatEmpty: '有什么想调整的吗？随时告诉我！',
    replanning: '正在重新计算...',
    uploadExcel: '上传 Excel 创建账单',
    uploadingExcel: '正在解析 Excel...',
  },
  en: {
    back: 'Back',
    title: 'Estimated Budget',
    subtitle: 'AI-generated estimated bill based on your itinerary.',
    generating: 'Calculating your estimated budget...',
    error: 'Failed to generate budget. Please try again.',
    total: 'Total Estimated',
    breakdown: 'Cost Breakdown',
    details: 'Detailed Bill',
    day: 'Day',
    daySuffix: '',
    noPlan: 'No itinerary data found. Please generate a plan first.',
    tableDay: 'Day',
    tableCategory: 'Category',
    tableItem: 'Item',
    tableAmount: 'Amount',
    tableNotes: 'Notes',
    myBudgets: 'My Budgets',
    saveBudget: 'Save Budget',
    savedSuccess: 'Saved Successfully',
    autoSaved: 'Auto-saved',
    noBudgets: 'No saved budgets yet',
    viewDetails: 'View Details',
    delete: 'Delete',
    destination: 'Destination',
    peopleCount: 'People',
    unitPrice: 'Unit Price',
    quantity: 'Qty',
    isPerPerson: 'Per Person',
    edit: 'Edit',
    done: 'Done',
    addItem: 'Add Item',
    recalculateAI: 'AI Recalculate',
    recalculating: 'AI Recalculating...',
    chatTitle: 'Modify Budget',
    chatPlaceholder: 'Tell me what to change, e.g., "Reduce dining budget" or "Add more nights"...',
    chatSend: 'Send',
    chatEmpty: 'Anything you want to adjust? Let me know!',
    replanning: 'Recalculating...',
    uploadExcel: 'Upload Excel',
    uploadingExcel: 'Parsing Excel...',
  }
};

export default function BudgetPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { userId: collabUserId, budgetId: collabBudgetId } = useParams();
  const isCollab = !!(collabUserId && collabBudgetId);
  const [language, setLanguage] = useState<'zh' | 'en'>('zh');
  const [budgetData, setBudgetData] = useState<BudgetData | null>(null);

  const locationState = location.state as any;
  const plan = locationState?.plan;
  const passedSavedBudget = locationState?.savedBudget as SavedBudget | undefined;
  const isShared = locationState?.isShared || false;

  const viewMode = (plan || passedSavedBudget || isCollab) ? 'detail' : 'list';
  
  const [savedBudgets, setSavedBudgets] = useState<SavedBudget[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isDeleted, setIsDeleted] = useState(false);
  const [budgetToDelete, setBudgetToDelete] = useState<SavedBudget | null>(null);
  const [isSaved, setIsSaved] = useState(false);
  const [currentFirestoreId, setCurrentFirestoreId] = useState<string | undefined>(passedSavedBudget?.firestoreId || collabBudgetId);
  const currentFirestoreIdRef = useRef<string | undefined>(passedSavedBudget?.firestoreId || collabBudgetId);

  const [currentBudgetId, setCurrentBudgetId] = useState<string | undefined>(passedSavedBudget?.id || collabBudgetId);
  const currentBudgetIdRef = useRef<string | undefined>(passedSavedBudget?.id || collabBudgetId);

  const isDirtyRef = useRef<boolean>(!passedSavedBudget?.firestoreId && !isCollab);

  const [isLoading, setIsLoading] = useState(true);
  const [isUploadingExcel, setIsUploadingExcel] = useState(false);
  const [loadingMessageIndex, setLoadingMessageIndex] = useState(0);

  const loadingMessages = {
    zh: [
      "正在为您分析目的地消费水平...",
      "正在为您智能匹配最划算的交通通票...",
      "正在为您精选高性价比的酒店方案...",
      "正在为您计算每日餐饮和市内交通开支...",
      "正在为您核对行程中的门票和活动费用...",
      "正在为您汇总各项开支并生成详细账单...",
      "即将完成，正在进行最后的预算优化..."
    ],
    en: [
      "Analyzing cost of living at your destination...",
      "Intelligently matching the best travel passes for you...",
      "Selecting high-value accommodation options...",
      "Calculating daily dining and local transit expenses...",
      "Checking ticket and activity costs in your itinerary...",
      "Summarizing all expenses and generating detailed bill...",
      "Almost there, performing final budget optimizations..."
    ]
  };

  useEffect(() => {
    let interval: any;
    if (isLoading) {
      interval = setInterval(() => {
        setLoadingMessageIndex((prev) => (prev + 1) % loadingMessages[language].length);
      }, 3000);
    }
    return () => clearInterval(interval);
  }, [isLoading, language]);

  const [isEditing, setIsEditing] = useState(false);
  const [isRecalculating, setIsRecalculating] = useState(false);
  const [isEditingPeopleCount, setIsEditingPeopleCount] = useState(false);
  const [tempPeopleCount, setTempPeopleCount] = useState(1);
  const [selectedCategory, setSelectedCategory] = useState<string>('All');

  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState<{ role: 'user' | 'ai', text: string }[]>([]);
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [sharingId, setSharingId] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [isCopied, setIsCopied] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setShowBackToTop(window.scrollY > 400);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const confirmDeleteBudget = async () => {
    if (!budgetToDelete) return;
    const budgetToProcess = budgetToDelete;
    setBudgetToDelete(null); // Close modal immediately
    const firestoreId = (budgetToProcess as any).firestoreId;
    
    setError(null);
    
    if (auth.currentUser && firestoreId) {
      try {
        await deleteDoc(doc(db, 'users', auth.currentUser.uid, 'budgets', firestoreId));
      } catch (error) {
        console.error(error);
        setError(language === 'zh' ? '删除失败，请重试。' : 'Failed to delete, please try again.');
        handleFirestoreError(error, OperationType.DELETE, `users/${auth.currentUser.uid}/budgets/${firestoreId}`);
        return;
      }
    } else {
      const updated = savedBudgets.filter(sb => sb.id !== budgetToProcess.id);
      setSavedBudgets(updated);
      localStorage.setItem('saved_budgets', JSON.stringify(updated));
    }

    setIsDeleted(true);
    setTimeout(() => setIsDeleted(false), 3000);
  };

  const generateBudgetFromExcel = async (csvData: string, filename: string) => {
    setIsUploadingExcel(true);
    try {
      const prompt = `
        I have uploaded an Excel file containing budget or itinerary data.
        Here is the data in CSV format:
        ${csvData}

        Please parse this data and convert it into a detailed travel budget in the following JSON format.
        Infer the categories, amounts, and details as best as you can.
        If the currency is not obvious, default to CNY (¥).
        Calculate the total amount and organize the line items.
        
        The response must be a valid JSON object matching this schema:
        {
          "currency": "string (e.g., CNY, USD, EUR, JPY)",
          "currencySymbol": "string (e.g., ¥, $, €, ¥)",
          "totalAmount": number,
          "peopleCount": number (default to 1 if not specified),
          "categories": [
            {
              "name": "string (e.g., 交通, 住宿, 餐饮, 门票, 购物, 其他)",
              "amount": number,
              "color": "string (hex color code)"
            }
          ],
          "lineItems": [
            {
              "dayNumber": number (default to 1 if not specified),
              "title": "string",
              "category": "string (must match one of the categories above)",
              "amount": number,
              "unitPrice": number,
              "quantity": number,
              "isPerPerson": boolean,
              "notes": "string (optional)"
            }
          ]
        }
      `;

      const response = await generateContentWithFallback({
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              currency: { type: Type.STRING },
              currencySymbol: { type: Type.STRING },
              totalAmount: { type: Type.NUMBER },
              peopleCount: { type: Type.NUMBER },
              categories: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    name: { type: Type.STRING },
                    amount: { type: Type.NUMBER },
                    color: { type: Type.STRING }
                  },
                  required: ["name", "amount", "color"]
                }
              },
              lineItems: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    dayNumber: { type: Type.NUMBER },
                    title: { type: Type.STRING },
                    category: { type: Type.STRING },
                    amount: { type: Type.NUMBER },
                    unitPrice: { type: Type.NUMBER },
                    quantity: { type: Type.NUMBER },
                    isPerPerson: { type: Type.BOOLEAN },
                    notes: { type: Type.STRING }
                  },
                  required: ["dayNumber", "title", "category", "amount", "unitPrice", "quantity", "isPerPerson"]
                }
              }
            },
            required: ["currency", "currencySymbol", "totalAmount", "peopleCount", "categories", "lineItems"]
          }
        }
      });

      const data = JSON.parse(response.text) as BudgetData;
      
      const newBudget: SavedBudget = {
        id: Date.now().toString(),
        destination: filename.replace(/\.[^/.]+$/, ""),
        days: Math.max(...data.lineItems.map(item => item.dayNumber), 1),
        createdAt: new Date().toISOString(),
        data: data
      };

      setIsUploadingExcel(false);
      navigate('/budget', { state: { savedBudget: newBudget } });
    } catch (err) {
      console.error("Failed to generate budget from Excel:", err);
      setError(language === 'zh' ? 'AI 生成账单失败，请重试。' : 'Failed to generate budget from AI. Please try again.');
      setIsUploadingExcel(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploadingExcel(true);
    setError(null);
    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data);
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const csvData = XLSX.utils.sheet_to_csv(worksheet);

      await generateBudgetFromExcel(csvData, file.name);
    } catch (err) {
      console.error("Failed to parse Excel file:", err);
      setError(language === 'zh' ? '解析 Excel 文件失败，请重试。' : 'Failed to parse Excel file. Please try again.');
      setIsUploadingExcel(false);
    }
    
    e.target.value = '';
  };

  const t = translations[language];

  const generateBudget = async (pCount?: number) => {
    if (!plan) return;
    console.log("Starting budget generation for:", plan.destination);
    setIsLoading(true);
    setIsRecalculating(true);
    const finalPeopleCount = pCount || plan.peopleCount || 1;
    try {
      const schema = {
        type: Type.OBJECT,
        properties: {
          currency: { type: Type.STRING, description: "Currency code, e.g., USD, CNY, EUR" },
          currencySymbol: { type: Type.STRING, description: "Currency symbol, e.g., $, ¥, €" },
          totalAmount: { type: Type.NUMBER },
          peopleCount: { type: Type.INTEGER, description: "Number of people for this budget" },
          categories: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING, description: "Category name in the requested language (e.g., 交通, 餐饮, 住宿 / Transport, Dining, Accommodation)" },
                amount: { type: Type.NUMBER },
                color: { type: Type.STRING, description: "Hex color code for the chart, use vibrant modern colors" }
              },
              required: ["name", "amount", "color"]
            }
          },
          lineItems: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                dayNumber: { type: Type.INTEGER },
                title: { type: Type.STRING },
                category: { type: Type.STRING },
                unitPrice: { type: Type.NUMBER, description: "Price per unit or per person" },
                quantity: { type: Type.NUMBER, description: "Quantity (if not per person)" },
                isPerPerson: { type: Type.BOOLEAN, description: "Whether this cost is per person" },
                isAccommodation: { type: Type.BOOLEAN, description: "True if this is a hotel/accommodation cost" },
                amount: { type: Type.NUMBER, description: "Total amount for this item (unitPrice * quantity or unitPrice * peopleCount)" },
                notes: { type: Type.STRING }
              },
              required: ["dayNumber", "title", "category", "unitPrice", "quantity", "isPerPerson", "amount"]
            }
          }
        },
        required: ["currency", "currencySymbol", "totalAmount", "peopleCount", "categories", "lineItems"]
      };

      const prompt = `
        You are an expert travel budget estimator.
        Based on the following travel itinerary, estimate a realistic budget.
        
        Destination: ${plan.destination}
        Days: ${plan.days}
        People Count: ${finalPeopleCount}
        Flight Included: ${plan.selectedFlight ? 'Yes, price: ' + plan.selectedFlight.price : 'No'}
        
        Itinerary Summary:
        ${JSON.stringify(plan.itinerary.map((d: any) => ({
          day: d.dayNumber,
          theme: d.theme,
          activities: d.events?.filter((e: any) => e.type === 'activity').map((a: any) => a.title) || [],
          transportation: d.events?.filter((e: any) => e.type === 'transportation').map((t: any) => t.title) || [],
          dining: d.events?.filter((e: any) => e.type === 'dining').map((di: any) => di.title) || [],
          accommodation: d.accommodation?.name || 'Standard'
        })), null, 2)}
        
        Language for output text (categories, titles, notes): ${language === 'zh' ? 'Chinese (Simplified)' : 'English'}
        
        Instructions:
        1. Estimate costs for flights (if applicable), accommodation, dining, transportation, and activities based on the destination's average cost of living.
        2. INTELLIGENT TRANSPORTATION: Evaluate if the itinerary justifies purchasing local travel passes (e.g., Swiss Travel Pass, Eurail Pass, Paris Visite, Japan Rail Pass, etc.). If a pass is more cost-effective than individual tickets for the planned route, include it as a line item and explain why in the notes.
        3. LOCAL TRANSIT: Always include estimated costs for local "small" transportation (metro, bus, taxi, ride-sharing) for each day, even if no major inter-city travel is planned. "Small" transportation refers ONLY to intra-city transport; it EXCLUDES inter-city transport like high-speed rail (高铁) or flights.
        4. Provide a total amount, a breakdown by category, and a detailed line-item list for each day.
        5. Use ${language === 'zh' ? 'CNY (¥)' : 'USD ($)'} currency. All prices MUST be in this currency.
        6. For each line item, specify if it's a per-person cost (isPerPerson: true) or a fixed quantity cost (isPerPerson: false).
        7. CRITICAL: Do NOT include free attractions or activities in the line items. If an item is free, omit it.
        8. CRITICAL: For accommodation, set \`isAccommodation\` to true, and \`isPerPerson\` to false. Calculate the number of rooms needed as Math.ceil(peopleCount / 2) (assuming 2 people per room). The \`quantity\` should be (number of nights * number of rooms). The \`unitPrice\` is the price per room per night.
        9. Ensure the sum of line items equals the total amount, and the sum of categories equals the total amount.
        10. Return ONLY valid JSON matching the schema.
        11. CRITICAL: Every line item MUST have a \`unitPrice\` > 0 and \`quantity\` > 0. Do not include items with 0 price or 0 quantity.
      `;

      const response = await generateContentWithFallback({
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: schema,
          temperature: 0.3,
        }
      });

      console.log("AI response received, parsing...");
      if (!response.text) {
        throw new Error('AI returned an empty response');
      }

      const data = JSON.parse(response.text) as BudgetData;
      console.log("Budget data parsed successfully");
      if (!data.lineItems || data.lineItems.length === 0) {
        throw new Error('AI returned a budget with no items');
      }
      
      setBudgetData(data);
      isDirtyRef.current = true;
      setTempPeopleCount(data.peopleCount || finalPeopleCount);
    } catch (err) {
      console.error("Failed to generate budget:", err);
      setError(t.error);
    } finally {
      console.log("Budget generation process finished");
      setIsLoading(false);
      setIsRecalculating(false);
    }
  };

  // Recalculate totals and categories whenever line items or people count change
  const updateBudgetData = (newLineItems: BudgetLineItem[], newPeopleCount?: number) => {
    if (!budgetData) return;

    const pCount = newPeopleCount !== undefined ? newPeopleCount : budgetData.peopleCount;
    const oldPCount = budgetData.peopleCount;
    
    // Calculate each item's total amount
    const processedItems = newLineItems.map(item => {
      let qty = Number(item.quantity) || 1;
      
      if (item.isPerPerson) {
        qty = pCount;
      } else if (item.isAccommodation && newPeopleCount !== undefined) {
        // Only scale accommodation if people count is actually changing
        const oldRooms = Math.ceil(oldPCount / 2) || 1;
        const newRooms = Math.ceil(pCount / 2);
        const nights = qty / oldRooms;
        qty = Math.max(1, Math.round(nights * newRooms));
      }

      const amount = (Number(item.unitPrice) || 0) * qty;
      return { ...item, quantity: qty, amount };
    });

    const total = processedItems.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
    
    // Update categories based on new line items
    const categoryMap = new Map<string, number>();
    processedItems.forEach(item => {
      const current = categoryMap.get(item.category) || 0;
      categoryMap.set(item.category, current + (Number(item.amount) || 0));
    });

    const newCategories = budgetData.categories.map(cat => ({
      ...cat,
      amount: categoryMap.get(cat.name) || 0
    }));

    // Add any new categories that might have been typed in
    categoryMap.forEach((amount, name) => {
      if (!newCategories.find(c => c.name === name)) {
        newCategories.push({
          name,
          amount,
          color: `#${Math.floor(Math.random()*16777215).toString(16)}` // Random color for new category
        });
      }
    });

    setBudgetData({
      ...budgetData,
      peopleCount: pCount,
      totalAmount: total,
      lineItems: processedItems,
      categories: newCategories
    });
    isDirtyRef.current = true;
  };

  const handleAddItem = () => {
    if (!budgetData) return;
    const newItem: BudgetLineItem = {
      dayNumber: 1,
      title: language === 'zh' ? '新项目' : 'New Item',
      category: budgetData.categories[0]?.name || (language === 'zh' ? '其他' : 'Other'),
      unitPrice: 0,
      quantity: 1,
      isPerPerson: true,
      amount: 0,
      notes: ''
    };
    updateBudgetData([...budgetData.lineItems, newItem]);
  };

  const handleDeleteItem = (index: number) => {
    if (!budgetData) return;
    const newLineItems = [...budgetData.lineItems];
    newLineItems.splice(index, 1);
    updateBudgetData(newLineItems);
  };

  const handleUpdateItem = (index: number, field: keyof BudgetLineItem, value: any) => {
    if (!budgetData) return;
    const newLineItems = [...budgetData.lineItems];
    newLineItems[index] = { ...newLineItems[index], [field]: value };
    updateBudgetData(newLineItems);
  };

  const handleSendMessage = async () => {
    if (!chatInput.trim() || !budgetData) return;
    
    const userMsg = chatInput.trim();
    setChatInput('');
    setChatMessages(prev => [...prev, { role: 'user', text: userMsg }]);
    setIsChatLoading(true);
    
    try {
      const schema = {
        type: Type.OBJECT,
        properties: {
          currency: { type: Type.STRING },
          currencySymbol: { type: Type.STRING },
          totalAmount: { type: Type.NUMBER },
          peopleCount: { type: Type.INTEGER },
          categories: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                amount: { type: Type.NUMBER },
                color: { type: Type.STRING }
              },
              required: ["name", "amount", "color"]
            }
          },
          lineItems: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                dayNumber: { type: Type.INTEGER },
                title: { type: Type.STRING },
                category: { type: Type.STRING },
                unitPrice: { type: Type.NUMBER },
                quantity: { type: Type.NUMBER },
                isPerPerson: { type: Type.BOOLEAN },
                isAccommodation: { type: Type.BOOLEAN },
                amount: { type: Type.NUMBER },
                notes: { type: Type.STRING }
              },
              required: ["dayNumber", "title", "category", "unitPrice", "quantity", "isPerPerson", "amount"]
            }
          },
          aiMessage: { type: Type.STRING, description: "A dynamic, friendly response explaining exactly what was updated in the budget." }
        },
        required: ["currency", "currencySymbol", "totalAmount", "peopleCount", "categories", "lineItems"]
      };

      const prompt = `You are a travel budget assistant. The user wants to modify their current budget estimate.
      Destination: ${plan?.destination || passedSavedBudget?.destination || 'Unknown'}
      Days: ${plan?.days || passedSavedBudget?.days || 'Unknown'}
      Current Budget JSON: ${JSON.stringify(budgetData)}
      User request: ${userMsg}
      
      Please modify the budget according to the user's request. Keep the same JSON structure.
      'aiMessage' should be a dynamic, friendly response explaining exactly what was updated (e.g., "I've reduced the dining budget by selecting more local street food options.").
      Return ONLY the updated JSON object containing 'currency', 'currencySymbol', 'totalAmount', 'peopleCount', 'categories', 'lineItems', and 'aiMessage'.
      IMPORTANT: Generate the content (including aiMessage) in ${language === 'zh' ? 'Simplified Chinese (简体中文)' : 'English'}. All prices should be in ${budgetData.currency}.`;
      
      const response = await generateContentWithFallback({
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: schema,
          temperature: 0.3,
        }
      });
      
      if (response.text) {
        const updatedData = JSON.parse(response.text) as BudgetData & { aiMessage?: string };
        setBudgetData(updatedData);
        isDirtyRef.current = true;
        setTempPeopleCount(updatedData.peopleCount);
        
        const defaultMsg = language === 'zh' ? '预算已更新！看看还有什么需要调整的吗？' : 'Budget updated! Let me know if you need any other changes.';
        setChatMessages(prev => [...prev, { role: 'ai', text: updatedData.aiMessage || defaultMsg }]);
      }
    } catch (err: any) {
      console.error(err);
      const errorMsg = language === 'zh' ? '抱歉，更新预算时出了点问题。' : 'Sorry, something went wrong while updating the budget.';
      setChatMessages(prev => [...prev, { role: 'ai', text: errorMsg }]);
    } finally {
      setIsChatLoading(false);
    }
  };

  useEffect(() => {
    if (isCollab && collabUserId && collabBudgetId) {
      const docRef = doc(db, 'users', collabUserId, 'budgets', collabBudgetId);
      const unsubscribe = onSnapshot(docRef, (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data();
          const parsedBudget = JSON.parse(data.data);
          setBudgetData(parsedBudget.data);
          setTempPeopleCount(parsedBudget.data.peopleCount || 1);
          setIsLoading(false);
        }
      }, (error) => {
        handleFirestoreError(error, OperationType.GET, `users/${collabUserId}/budgets/${collabBudgetId}`);
      });
      return () => unsubscribe();
    }

    let unsubscribe: () => void = () => {};

    const authUnsubscribe = onAuthStateChanged(auth, (user) => {
      if (user && !isCollab) {
        const q = query(collection(db, 'users', user.uid, 'budgets'));
        unsubscribe = onSnapshot(q, (snapshot) => {
          const cloudBudgets = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
              ...JSON.parse(data.data),
              firestoreId: doc.id
            };
          });
          setSavedBudgets(cloudBudgets.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
          if (viewMode === 'list') {
            setIsLoading(false);
          }
        }, (error) => {
          handleFirestoreError(error, OperationType.LIST, `users/${user.uid}/budgets`);
          if (viewMode === 'list') {
            setIsLoading(false);
          }
        });
      } else {
        const saved = JSON.parse(localStorage.getItem('saved_budgets') || '[]');
        setSavedBudgets(saved.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
        if (viewMode === 'list') {
          setIsLoading(false);
        }
      }
    });

    return () => {
      authUnsubscribe();
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (viewMode === 'list') return;

    if (passedSavedBudget) {
      const data = passedSavedBudget.data;
      setBudgetData({
        ...data,
        peopleCount: data.peopleCount || 1
      });
      setTempPeopleCount(data.peopleCount || 1);
      setIsLoading(false);
      return;
    }

    if (!plan) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    generateBudget();
  }, [plan, passedSavedBudget, language, t.error, t.noPlan]);

  const handleSaveBudget = async (dataToSave?: BudgetData) => {
    if (isShared) return; // Do not auto-save shared budgets

    const currentData = dataToSave || budgetData;
    if (!currentData || (!plan && !passedSavedBudget)) return;

    const destination = plan?.destination || passedSavedBudget?.destination || '';
    const daysCount = typeof plan?.days === 'number' 
      ? plan.days 
      : (Array.isArray(plan?.days) ? plan.days.length : (passedSavedBudget?.days || 0));

    const budgetToSave: SavedBudget = {
      id: currentBudgetIdRef.current || Date.now().toString() + '-' + Math.random().toString(36).substr(2, 9),
      destination,
      days: daysCount,
      createdAt: passedSavedBudget?.createdAt || new Date().toISOString(),
      data: currentData
    };

    if (!currentBudgetIdRef.current) {
      setCurrentBudgetId(budgetToSave.id);
      currentBudgetIdRef.current = budgetToSave.id;
    }

    if (auth.currentUser || isCollab) {
      const docId = currentFirestoreIdRef.current;
      try {
        const userIdToSave = isCollab ? collabUserId! : auth.currentUser!.uid;
        const docRef = docId 
          ? doc(db, 'users', userIdToSave, 'budgets', docId)
          : doc(collection(db, 'users', auth.currentUser!.uid, 'budgets'));
        
        if (!docId) {
          setCurrentFirestoreId(docRef.id);
          currentFirestoreIdRef.current = docRef.id;
        }

        await setDoc(docRef, {
          userId: isCollab ? collabUserId! : auth.currentUser!.uid,
          destination: destination ? destination.substring(0, 190) : 'Custom',
          days: daysCount,
          createdAt: budgetToSave.createdAt,
          data: JSON.stringify({ ...budgetToSave, firestoreId: docRef.id })
        }, { merge: true });
      } catch (error) {
        handleFirestoreError(error, docId ? OperationType.UPDATE : OperationType.CREATE, `users/${isCollab ? collabUserId : auth.currentUser?.uid}/budgets`);
      }
    } else {
      let updated: SavedBudget[];
      if (currentBudgetIdRef.current) {
        updated = savedBudgets.map(sb => sb.id === currentBudgetIdRef.current ? budgetToSave : sb);
      } else {
        updated = [budgetToSave, ...savedBudgets];
      }
      setSavedBudgets(updated);
      localStorage.setItem('saved_budgets', JSON.stringify(updated));
    }
    
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 3000);
  };

  const handleShareList = async (budget: SavedBudget, e: React.MouseEvent) => {
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

  const handleCollab = async () => {
    if (!budgetData || !auth.currentUser) {
      if (!auth.currentUser) {
        alert(language === 'zh' ? '请先登录以邀请共创' : 'Please log in to invite collaborators');
      }
      return;
    }
    
    const docId = currentFirestoreIdRef.current;
    if (!docId) {
      alert(language === 'zh' ? '请先保存账单' : 'Please save the budget first');
      return;
    }

    setSharingId('current');
    try {
      const docRef = doc(db, 'users', auth.currentUser.uid, 'budgets', docId);
      await updateDoc(docRef, {
        isPublicEdit: true
      });

      const url = `${window.location.origin}/collab/budget/${auth.currentUser.uid}/${docId}`;
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

  const handleShare = async () => {
    if (!budgetData || !auth.currentUser) {
      if (!auth.currentUser) {
        alert(language === 'zh' ? '请先登录以分享账单' : 'Please log in to share the budget');
      }
      return;
    }
    
    setSharingId('current');
    try {
      const budgetToShare = {
        destination: plan?.destination || passedSavedBudget?.destination || '',
        days: typeof plan?.days === 'number' 
          ? plan.days 
          : (Array.isArray(plan?.days) ? plan.days.length : (passedSavedBudget?.days || 0)),
        data: budgetData
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
      
      // Try to copy to clipboard
      try {
        await navigator.clipboard.writeText(url);
        setIsCopied(true);
        setTimeout(() => setIsCopied(false), 2000);
      } catch (err) {
        console.error("Failed to copy:", err);
        // Fallback or just show the URL in UI
      }
    } catch (error) {
      console.error("Error sharing:", error);
      alert(language === 'zh' ? '分享失败，请重试' : 'Failed to share, please try again');
    } finally {
      setSharingId(null);
    }
  };

  // Auto-save effect
  useEffect(() => {
    if (!budgetData || !isDirtyRef.current) return;
    
    // Debounce auto-save
    const timer = setTimeout(() => {
      // Only auto-save if something actually changed and we have enough info
      if (plan || passedSavedBudget) {
        handleSaveBudget(budgetData);
        isDirtyRef.current = false;
      }
    }, 2000);

    return () => clearTimeout(timer);
  }, [budgetData]);

  if (viewMode === 'list') {
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

          {/* Confirmation Modal */}
          {budgetToDelete && (
            <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
              <div className="bg-white rounded-3xl p-8 max-w-sm w-full shadow-2xl">
                <h3 className="text-xl font-bold text-gray-900 mb-4">
                  {language === 'zh' ? '确定删除账单？' : 'Delete budget?'}
                </h3>
                <p className="text-gray-500 mb-8">
                  {language === 'zh' ? '此操作不可撤销。' : 'This action cannot be undone.'}
                </p>
                <div className="flex gap-4">
                  <button 
                    onClick={() => setBudgetToDelete(null)}
                    className="flex-1 px-5 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-semibold transition-colors"
                  >
                    {language === 'zh' ? '取消' : 'Cancel'}
                  </button>
                  <button 
                    onClick={confirmDeleteBudget}
                    className="flex-1 px-5 py-3 bg-red-500 hover:bg-red-600 text-white rounded-xl font-semibold transition-colors"
                  >
                    {language === 'zh' ? '删除' : 'Delete'}
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <h1 className="text-4xl font-bold text-gray-900 tracking-tight flex items-center gap-3">
              <Receipt className="text-emerald-500" size={32} />
              {t.myBudgets}
            </h1>
            <div>
              <input 
                type="file" 
                accept=".xlsx, .xls, .csv" 
                className="hidden" 
                id="excel-upload"
                onChange={handleFileUpload}
              />
              <label 
                htmlFor="excel-upload" 
                className={`cursor-pointer flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold transition-colors shadow-sm ${isUploadingExcel ? 'bg-gray-400 text-white cursor-not-allowed' : 'bg-emerald-500 hover:bg-emerald-600 text-white'}`}
              >
                {isUploadingExcel ? <Loader2 size={20} className="animate-spin" /> : <Upload size={20} />}
                {isUploadingExcel ? t.uploadingExcel : t.uploadExcel}
              </label>
            </div>
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
            <div className="flex flex-col items-center justify-center p-12 gap-4">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500"></div>
              <p className="text-gray-500 font-medium">
                {language === 'zh' ? '正在加载您的账单...' : 'Loading your budgets...'}
              </p>
            </div>
          ) : savedBudgets.length === 0 ? (
            <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-12 text-center">
              <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4">
                <Receipt className="text-gray-300" size={32} />
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-2">{t.noBudgets}</h3>
            </div>
          ) : (
            <div className="space-y-6">
              {savedBudgets.map((b, index) => {
                const uniqueKey = b.firestoreId || `${b.id}-${index}`;
                return (
                <div 
                  key={uniqueKey} 
                  className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden transition-all p-6 md:p-8 cursor-pointer hover:bg-gray-50 flex flex-col md:flex-row md:items-center justify-between gap-6" 
                  onClick={() => navigate('/budget', { state: { savedBudget: b } })}
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-3">
                      <span className="px-3 py-1 bg-emerald-100 text-emerald-700 text-sm font-bold rounded-lg">
                        {b.days} {t.daySuffix || 'Days'}
                      </span>
                      <span className="text-sm text-gray-500 font-medium">
                        {new Date(b.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                    <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
                      <MapPin className="text-emerald-500" size={24} /> {b.destination}
                    </h2>
                    <div className="text-2xl font-bold text-emerald-600 mt-2">
                      {b.data.currencySymbol}{(b.data.totalAmount ?? 0).toLocaleString()}
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <button 
                      onClick={(e) => handleShareList(b, e)}
                      disabled={sharingId === b.id}
                      className="p-2.5 text-blue-500 hover:bg-blue-50 rounded-xl transition-colors disabled:opacity-50"
                      title={language === 'zh' ? '分享' : 'Share'}
                    >
                      {sharingId === b.id ? <Loader2 size={20} className="animate-spin" /> : <Share size={20} />}
                    </button>
                    <button className="px-5 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-semibold text-sm transition-colors">
                      {t.viewDetails}
                    </button>
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        setBudgetToDelete(b);
                      }}
                      className="p-2.5 text-red-500 hover:bg-red-50 rounded-xl transition-colors"
                    >
                      <Trash2 size={20} />
                    </button>
                  </div>
                </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  const handleAddToMyBudgets = async () => {
    if (!budgetData) return;
    
    const budgetToSave = {
      id: Date.now().toString() + '-' + Math.random().toString(36).substr(2, 9),
      destination: plan ? plan.destination : (passedSavedBudget?.destination || 'Unknown'),
      days: plan ? plan.days : (passedSavedBudget?.days || 1),
      createdAt: new Date().toISOString(),
      data: budgetData
    };

    if (auth.currentUser) {
      try {
        const docRef = doc(collection(db, 'users', auth.currentUser.uid, 'budgets'));
        await setDoc(docRef, {
          userId: auth.currentUser.uid,
          destination: budgetToSave.destination,
          days: budgetToSave.days,
          createdAt: budgetToSave.createdAt,
          data: JSON.stringify({ ...budgetToSave, firestoreId: docRef.id })
        });
        alert(language === 'zh' ? '已添加到我的账单！' : 'Added to my budgets!');
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, `users/${auth.currentUser.uid}/budgets`);
      }
    } else {
      const existingBudgets = JSON.parse(localStorage.getItem('saved_travel_budgets') || '[]');
      localStorage.setItem('saved_travel_budgets', JSON.stringify([...existingBudgets, budgetToSave]));
      alert(language === 'zh' ? '已添加到本地账单！' : 'Added to local budgets!');
    }
  };

  if (!plan && !passedSavedBudget && !isLoading) {
    return (
      <div className="min-h-screen bg-[#faf9f8] p-8 flex flex-col items-center justify-center">
        <AlertCircle size={48} className="text-red-500 mb-4" />
        <h2 className="text-xl font-bold text-gray-900 mb-4">{error}</h2>
        <button onClick={() => navigate('/')} className="px-6 py-2 bg-blue-600 text-white rounded-xl">
          {t.back}
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#faf9f8] p-4 md:p-8 font-sans selection:bg-blue-100 pb-32">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <button 
            onClick={() => navigate(-1)}
            className="flex items-center gap-2 text-gray-500 hover:text-gray-900 transition-colors font-medium"
          >
            <ArrowLeft size={20} />
            {t.back}
          </button>
          
          <div className="flex items-center gap-4">
            {(isShared || (isCollab && auth.currentUser?.uid !== collabUserId)) && (
              <button
                onClick={handleAddToMyBudgets}
                className="text-sm font-semibold text-emerald-600 hover:text-emerald-700 bg-emerald-50 hover:bg-emerald-100 px-4 py-2 rounded-full transition-colors flex items-center gap-2"
              >
                <Plus size={16} />
                {language === 'zh' ? '添加到我的账单' : 'Add to my budgets'}
              </button>
            )}
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

        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 tracking-tight flex items-center gap-3">
            <Receipt className="text-emerald-500" size={32} />
            {t.title}
          </h1>
          <p className="text-gray-500 mt-2 text-lg">{t.subtitle}</p>
        </div>

        {isLoading ? (
          <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-16 flex flex-col items-center justify-center text-center min-h-[400px]">
            <div className="relative mb-8">
              <Loader2 size={64} className="text-emerald-500 animate-spin" />
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-2 h-2 bg-emerald-500 rounded-full animate-ping"></div>
              </div>
            </div>
            <h3 className="text-2xl font-bold text-gray-900 mb-4 transition-all duration-500">
              {loadingMessages[language][loadingMessageIndex]}
            </h3>
            <p className="text-gray-500 max-w-md animate-pulse">
              {language === 'zh' ? 'AI 正在深度分析您的行程，请稍候片刻' : 'AI is deeply analyzing your itinerary, please wait a moment'}
            </p>
          </div>
        ) : error ? (
          <div className="bg-white rounded-3xl shadow-sm border border-red-100 p-12 text-center">
            <AlertCircle size={48} className="text-red-500 mx-auto mb-4" />
            <h3 className="text-xl font-bold text-gray-900 mb-2">{error}</h3>
          </div>
        ) : budgetData ? (
            <div className="flex flex-col gap-8">
              {/* Top Section: Chart and Summary */}
              <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
                {/* Total Card */}
                <div className="bg-gradient-to-br from-emerald-500 to-teal-600 rounded-3xl p-8 text-white shadow-lg shadow-emerald-500/20 flex flex-col items-center justify-center text-center">
                  <p className="text-emerald-100 font-medium mb-1 flex items-center gap-2">
                    <DollarSign size={18} />
                    {t.total}
                  </p>
                  <div className="text-5xl font-bold tracking-tight">
                    {budgetData.currencySymbol}{(budgetData.totalAmount ?? 0).toLocaleString()}
                  </div>
                  <div className="mt-3 bg-white/20 px-4 py-1.5 rounded-full text-sm font-medium backdrop-blur-sm">
                    {language === 'zh' ? '人均预估' : 'Per Person'}: {budgetData.currencySymbol}{Math.round((budgetData.totalAmount ?? 0) / (budgetData.peopleCount || 1)).toLocaleString()}
                  </div>
                  <p className="text-emerald-100/80 text-sm mt-3">
                    {plan ? `${plan.origin} → ${plan.destination}` : passedSavedBudget?.destination} ({plan ? plan.days : passedSavedBudget?.days} {language === 'zh' ? '天' : 'Days'})
                  </p>
                </div>

                {/* People Count Card */}
                <div className="bg-white p-8 rounded-3xl shadow-sm border border-gray-100 flex flex-col items-center justify-center text-center relative overflow-hidden">
                  <p className="text-gray-500 font-medium mb-3 flex items-center gap-2">
                    <MapPin size={18} className="text-blue-500" />
                    {t.peopleCount}
                  </p>
                  <div className="flex flex-col items-center gap-4">
                    <div className="flex items-center gap-3">
                      {isEditingPeopleCount ? (
                        <div className="flex items-center gap-2">
                          <input 
                            type="number"
                            min="1"
                            value={tempPeopleCount}
                            onChange={(e) => setTempPeopleCount(Math.max(1, Number(e.target.value)))}
                            className="w-16 text-3xl font-bold text-center text-gray-900 border-b-2 border-emerald-500 focus:outline-none bg-emerald-50/30 rounded-t-lg"
                            autoFocus
                          />
                          <button 
                            onClick={() => {
                              setIsEditingPeopleCount(false);
                              updateBudgetData(budgetData.lineItems, tempPeopleCount);
                            }}
                            className="p-2 bg-emerald-500 text-white rounded-full hover:bg-emerald-600 transition-colors shadow-sm"
                            title={language === 'zh' ? '保存并重新计算' : 'Save and Recalculate'}
                          >
                            <Save size={18} />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-3 group">
                          <div className="text-4xl font-bold text-gray-900">
                            {budgetData.peopleCount}
                          </div>
                          <button 
                            onClick={() => {
                              setTempPeopleCount(budgetData.peopleCount);
                              setIsEditingPeopleCount(true);
                            }}
                            className="p-2 text-emerald-500 hover:bg-emerald-50 rounded-full transition-all"
                          >
                            <Edit2 size={18} />
                          </button>
                        </div>
                      )}
                    </div>
                    {!isEditingPeopleCount && (
                      <p className="text-[10px] text-gray-400 uppercase tracking-widest font-bold">
                        {language === 'zh' ? '点击图标编辑人数' : 'Click icon to edit'}
                      </p>
                    )}
                  </div>
                </div>

                {/* Chart */}
                <div className="lg:col-span-2 bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
                  <h3 className="text-xl font-bold text-gray-900 mb-6 flex items-center gap-2">
                    <PieChartIcon className="text-purple-500" size={24} />
                    {t.breakdown}
                  </h3>
                  <div className="h-[300px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={budgetData.categories}
                          cx="50%"
                          cy="50%"
                          innerRadius={80}
                          outerRadius={110}
                          paddingAngle={5}
                          dataKey="amount"
                          nameKey="name"
                        >
                          {budgetData.categories.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip 
                          formatter={(value: number, name: string) => [`${budgetData.currencySymbol}${(value ?? 0).toLocaleString()}`, name]}
                          contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                        />
                        <Legend verticalAlign="bottom" height={36} iconType="circle" />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>

              {/* Detailed Table - Full Width and Editable */}
              <div className="bg-white p-6 md:p-8 rounded-3xl shadow-sm border border-gray-100 overflow-hidden flex flex-col min-h-[600px] relative">
                {isRecalculating && (
                  <div className="absolute inset-0 bg-white/60 backdrop-blur-[2px] z-20 flex flex-col items-center justify-center text-center">
                    <div className="bg-white p-8 rounded-2xl shadow-xl border border-gray-100 flex flex-col items-center">
                      <Loader2 size={40} className="text-emerald-500 animate-spin mb-4" />
                      <h4 className="text-lg font-bold text-gray-900">{t.recalculating}</h4>
                      <p className="text-sm text-gray-500 mt-1">AI 正在为您重新计算详细账单...</p>
                    </div>
                  </div>
                )}
                <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 shrink-0 gap-4">
                  <div className="flex flex-col gap-4">
                    <h3 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                      <Receipt className="text-blue-500" size={28} />
                      {t.details}
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => setSelectedCategory('All')}
                        className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${selectedCategory === 'All' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                      >
                        {language === 'zh' ? '全部' : 'All'}
                      </button>
                      {budgetData.categories.map(c => (
                        <button
                          key={c.name}
                          onClick={() => setSelectedCategory(c.name)}
                          className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${selectedCategory === c.name ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                        >
                          {c.name}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    {isEditing && (
                      <button 
                        onClick={handleAddItem}
                        className="px-4 py-2 bg-emerald-50 text-emerald-600 hover:bg-emerald-100 rounded-xl font-bold text-sm transition-colors flex items-center gap-2"
                      >
                        <DollarSign size={16} />
                        {language === 'zh' ? '添加项目' : 'Add Item'}
                      </button>
                    )}
                    <button 
                      onClick={() => setIsEditing(!isEditing)}
                      className={`px-6 py-2 rounded-xl font-bold text-sm transition-all ${isEditing ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                    >
                      {isEditing ? (language === 'zh' ? '完成编辑' : 'Done') : (language === 'zh' ? '编辑账单' : 'Edit')}
                    </button>
                  </div>
                </div>
                
                <div className="flex-1 overflow-auto pr-2">
                  <table className="w-full text-left border-collapse min-w-[800px]">
                    <thead className="sticky top-0 bg-white z-10 shadow-sm">
                      <tr>
                        <th className="py-4 px-4 text-xs font-bold text-gray-400 uppercase tracking-wider border-b border-gray-100">{t.tableDay}</th>
                        <th className="py-4 px-4 text-xs font-bold text-gray-400 uppercase tracking-wider border-b border-gray-100">{t.tableCategory}</th>
                        <th className="py-4 px-4 text-xs font-bold text-gray-400 uppercase tracking-wider border-b border-gray-100">{t.tableItem}</th>
                        <th className="py-4 px-4 text-xs font-bold text-gray-400 uppercase tracking-wider border-b border-gray-100 text-right">{t.unitPrice}</th>
                        <th className="py-4 px-4 text-xs font-bold text-gray-400 uppercase tracking-wider border-b border-gray-100 text-center">{t.quantity}</th>
                        {isEditing ? (
                          <>
                            <th className="py-4 px-4 text-xs font-bold text-gray-400 uppercase tracking-wider border-b border-gray-100 text-center">{t.isPerPerson}</th>
                          </>
                        ) : null}
                        <th className="py-4 px-4 text-xs font-bold text-gray-400 uppercase tracking-wider border-b border-gray-100 text-right">{t.tableAmount}</th>
                        <th className="py-4 px-4 text-xs font-bold text-gray-400 uppercase tracking-wider border-b border-gray-100">{t.tableNotes}</th>
                        {isEditing && <th className="py-4 px-4 border-b border-gray-100"></th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {budgetData.lineItems.map((item, idx) => {
                        if (selectedCategory !== 'All' && item.category !== selectedCategory) return null;
                        const categoryColor = budgetData.categories.find(c => c.name === item.category)?.color || '#9ca3af';
                        return (
                          <tr key={idx} className="hover:bg-gray-50/50 transition-colors">
                            <td className="py-4 px-4 text-sm text-gray-600 whitespace-nowrap">
                              {isEditing ? (
                                <input 
                                  type="number"
                                  value={item.dayNumber}
                                  onChange={(e) => handleUpdateItem(idx, 'dayNumber', Number(e.target.value))}
                                  className="w-16 px-2 py-1 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                                />
                              ) : (
                                <span className="font-medium">{t.day} {item.dayNumber} {t.daySuffix}</span>
                              )}
                            </td>
                            <td className="py-4 px-4 text-sm text-gray-900 whitespace-nowrap">
                              {isEditing ? (
                                <select 
                                  value={item.category}
                                  onChange={(e) => handleUpdateItem(idx, 'category', e.target.value)}
                                  className="px-2 py-1 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                                >
                                  {budgetData.categories.map(c => (
                                    <option key={c.name} value={c.name}>{c.name}</option>
                                  ))}
                                </select>
                              ) : (
                                <div className="flex items-center gap-2">
                                  <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: categoryColor }} />
                                  <span className="font-medium">{item.category}</span>
                                </div>
                              )}
                            </td>
                            <td className="py-4 px-4 text-sm font-medium text-gray-900">
                              {isEditing ? (
                                <input 
                                  type="text"
                                  value={item.title}
                                  onChange={(e) => handleUpdateItem(idx, 'title', e.target.value)}
                                  className="w-full px-2 py-1 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                                />
                              ) : (
                                item.title
                              )}
                            </td>
                            <td className="py-4 px-4 text-sm font-medium text-gray-900 text-right">
                              {isEditing ? (
                                <div className="flex items-center justify-end gap-1">
                                  <span className="text-gray-400">{budgetData.currencySymbol}</span>
                                  <input 
                                    type="number"
                                    value={item.unitPrice}
                                    onChange={(e) => handleUpdateItem(idx, 'unitPrice', Number(e.target.value))}
                                    className="w-20 px-2 py-1 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-right"
                                  />
                                </div>
                              ) : (
                                <span>{budgetData.currencySymbol}{(item.unitPrice ?? 0).toLocaleString()}</span>
                              )}
                            </td>
                            <td className="py-4 px-4 text-sm font-medium text-gray-900 text-center">
                              {isEditing ? (
                                <input 
                                  type="number"
                                  value={item.isPerPerson ? budgetData.peopleCount : item.quantity}
                                  disabled={item.isPerPerson}
                                  onChange={(e) => handleUpdateItem(idx, 'quantity', Number(e.target.value))}
                                  className={`w-16 px-2 py-1 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-center ${item.isPerPerson ? 'bg-gray-50 text-gray-400' : ''}`}
                                />
                              ) : (
                                <span>{item.isPerPerson ? budgetData.peopleCount : item.quantity}</span>
                              )}
                            </td>
                            {isEditing && (
                              <>
                                <td className="py-4 px-4 text-sm font-medium text-gray-900 text-center">
                                  <input 
                                    type="checkbox"
                                    checked={item.isPerPerson}
                                    onChange={(e) => handleUpdateItem(idx, 'isPerPerson', e.target.checked)}
                                    className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                                  />
                                </td>
                              </>
                            )}
                            <td className="py-4 px-4 text-sm font-bold text-gray-900 whitespace-nowrap text-right">
                              <span className={isEditing ? 'text-gray-400' : 'text-emerald-600'}>
                                {budgetData.currencySymbol}{(item.amount ?? 0).toLocaleString()}
                              </span>
                            </td>
                            <td className="py-4 px-4 text-xs text-gray-500">
                              {isEditing ? (
                                <input 
                                  type="text"
                                  value={item.notes || ''}
                                  onChange={(e) => handleUpdateItem(idx, 'notes', e.target.value)}
                                  className="w-full px-2 py-1 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                                />
                              ) : (
                                <span className="max-w-[200px] block truncate" title={item.notes}>
                                  {item.notes || '-'}
                                </span>
                              )}
                            </td>
                            {isEditing && (
                              <td className="py-4 px-4 text-right">
                                <button 
                                  onClick={() => handleDeleteItem(idx)}
                                  className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                >
                                  <Trash2 size={16} />
                                </button>
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            {/* Floating Save Button */}
            {!passedSavedBudget && budgetData && (
              <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-40 flex flex-col items-center gap-3">
                <button
                  onClick={() => handleSaveBudget()}
                  className="bg-gray-900 hover:bg-gray-800 text-white px-8 py-4 rounded-full font-bold shadow-xl shadow-gray-900/20 flex items-center gap-3 transition-all hover:scale-105 active:scale-95"
                >
                  <Save size={20} />
                  {t.saveBudget}
                </button>
              </div>
            )}

            {/* FABs Container */}
            <div className="fixed bottom-8 right-8 z-50 flex flex-col gap-4 items-end">
              {/* Auto-save Indicator */}
              {isSaved && (
                <div className="bg-emerald-500 text-white px-4 py-2 rounded-full text-sm font-bold shadow-lg flex items-center gap-2 animate-in slide-in-from-bottom-2 fade-in">
                  <Check size={16} />
                  {t.autoSaved}
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
              {budgetData && (
                <button
                  onClick={handleCollab}
                  disabled={sharingId === 'current'}
                  className="w-14 h-14 bg-indigo-600 hover:bg-indigo-700 text-white rounded-full font-bold shadow-lg shadow-indigo-600/20 flex items-center justify-center transition-all hover:scale-105 active:scale-95 animate-in fade-in slide-in-from-bottom-4 disabled:opacity-50 disabled:cursor-not-allowed"
                  title={language === 'zh' ? '邀请共创' : 'Invite Collaborators'}
                >
                  <Users size={24} />
                </button>
              )}

              {/* Share FAB */}
              {budgetData && (
                <button
                  onClick={handleShare}
                  disabled={sharingId === 'current'}
                  className="w-14 h-14 bg-blue-600 hover:bg-blue-700 text-white rounded-full font-bold shadow-lg shadow-blue-600/20 flex items-center justify-center transition-all hover:scale-105 active:scale-95 animate-in fade-in slide-in-from-bottom-4 disabled:opacity-50 disabled:cursor-not-allowed"
                  title={language === 'zh' ? '分享账单' : 'Share Budget'}
                >
                  {sharingId === 'current' ? <Loader2 size={24} className="animate-spin" /> : <Share size={24} />}
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
        ) : null}

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
