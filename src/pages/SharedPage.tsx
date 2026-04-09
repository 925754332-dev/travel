import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { Loader2, AlertCircle, ArrowLeft } from 'lucide-react';

export default function SharedPage() {
  const { shareId } = useParams();
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchSharedItem = async () => {
      if (!shareId) return;
      
      try {
        const docRef = doc(db, 'shared_items', shareId);
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
          const data = docSnap.data();
          const parsedData = JSON.parse(data.data);
          
          if (data.type === 'plan') {
            navigate('/plan', { state: { savedPlan: parsedData, isShared: true }, replace: true });
          } else if (data.type === 'budget') {
            navigate('/budget', { state: { savedBudget: parsedData, isShared: true }, replace: true });
          } else {
            setError('Unknown shared item type.');
            setIsLoading(false);
          }
        } else {
          setError('Shared item not found or has been deleted.');
          setIsLoading(false);
        }
      } catch (err) {
        console.error("Error fetching shared item:", err);
        setError('Failed to load shared item.');
        setIsLoading(false);
        handleFirestoreError(err, OperationType.GET, `shared_items/${shareId}`);
      }
    };

    fetchSharedItem();
  }, [shareId, navigate]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#faf9f8] flex flex-col items-center justify-center">
        <Loader2 className="w-12 h-12 text-blue-500 animate-spin mb-4" />
        <p className="text-gray-600 font-medium">Loading shared item...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#faf9f8] flex flex-col items-center justify-center p-4">
      <div className="bg-white rounded-3xl p-8 max-w-md w-full shadow-xl text-center">
        <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Oops!</h2>
        <p className="text-gray-600 mb-8">{error}</p>
        <button
          onClick={() => navigate('/')}
          className="flex items-center justify-center gap-2 w-full py-3 bg-gray-900 hover:bg-gray-800 text-white rounded-xl font-semibold transition-colors"
        >
          <ArrowLeft size={20} />
          Back to Home
        </button>
      </div>
    </div>
  );
}
