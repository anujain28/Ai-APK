import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { fetchTopStockPicks, analyzeHoldings } from './services/geminiService';
import { fetchRealStockData } from './services/marketDataService';
import { checkAndRefreshStockList, STATIC_MCX_LIST, STATIC_FOREX_LIST, STATIC_CRYPTO_LIST } from './services/stockListService';
import { StockRecommendation, PortfolioItem, MarketData, PortfolioHistoryPoint, Transaction, AppSettings, Candle, AssetType, UserProfile, Funds, HoldingAnalysis } from './types';
import { StockCard } from './components/StockCard';
import { PortfolioTable } from './components/PortfolioTable';
import { TradeModal } from './components/TradeModal';
import { PortfolioChart } from './components/PortfolioChart';
import { ActivityFeed } from './components/ActivityFeed';
import { SettingsModal } from './components/SettingsModal';
import { AuthOverlay } from './components/AuthOverlay';
import { InstallPWA } from './components/InstallPWA';
import { analyzeStockTechnical } from './services/technicalAnalysis';
import { generatePNLReport, sendTelegramMessage } from './services/telegramService';
import { fetchDhanHoldings, fetchShoonyaHoldings, placeDhanOrder, placeShoonyaOrder, fetchBinanceHoldings, fetchCoinDCXHoldings, fetchCoinSwitchHoldings, placeBinanceOrder, placeCoinDCXOrder, placeCoinSwitchOrder, fetchBrokerBalance } from './services/brokerService';
import { Wallet, PieChart, RefreshCw, BarChart3, TrendingUp, TrendingDown, Bot, Settings, Send, Clock, Play, Pause, ChevronDown, AlertCircle, Eye, Globe, DollarSign, LogOut, User, Cpu, Sparkles, Building2, LayoutGrid, LayoutDashboard, Menu, Activity } from 'lucide-react';

const generateFallbackHistory = (startPrice: number, count: number): Candle[] => {
    const candles: Candle[] = [];
    let price = startPrice;
    let time = Date.now() - (count * 300000); 
    
    for(let i=0; i<count; i++) {
        const volatility = 0.002;
        const change = (Math.random() - 0.5) * 2 * volatility;
        const close = price * (1 + change);
        const high = Math.max(price, close) * (1 + Math.random() * 0.001);
        const low = Math.min(price, close) * (1 - Math.random() * 0.001);
        const open = price;
        const volume = Math.floor(Math.random() * 10000);
        
        candles.push({ time, open, high, low, close, volume });
        price = close;
        time += 300000;
    }
    return candles;
};

const STORAGE_KEYS = {
  SETTINGS: 'aitrade_settings_v7',
  PORTFOLIO: 'aitrade_portfolio_v3',
  FUNDS: 'aitrade_funds_v2', 
  TRANSACTIONS: 'aitrade_transactions',
  HISTORY: 'aitrade_history',
  USER: 'aitrade_user_profile',
  MARKET_BOTS: 'aitrade_market_bots_v1'
};

export default function App() {
  
  const [user, setUser] = useState<UserProfile | null>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.USER);
    return saved ? JSON.parse(saved) : null;
  });

  const [settings, setSettings] = useState<AppSettings>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    const defaults = {
        initialFunds: { stock: 1000000, mcx: 500000, forex: 500000, crypto: 500000 },
        autoTradeConfig: { mode: 'PERCENTAGE', value: 5 },
        activeBrokers: ['PAPER', 'DHAN', 'SHOONYA', 'BINANCE', 'COINDCX', 'COINSWITCH'], 
        enabledMarkets: { stocks: true, mcx: true, forex: true, crypto: true }, 
        telegramBotToken: '',
        telegramChatId: ''
    } as AppSettings;

    if (!saved) return defaults;
    const parsed = JSON.parse(saved);
    return { ...defaults, ...parsed, autoTradeConfig: parsed.autoTradeConfig || defaults.autoTradeConfig };
  });

  // Mobile Tab State
  const [mobileTab, setMobileTab] = useState<'HOME' | 'MARKET' | 'PORTFOLIO' | 'MORE'>('HOME');

  // Funds & Data States
  const [funds, setFunds] = useState<Funds>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.FUNDS);
    if (saved) {
        const f = JSON.parse(saved);
        if(!f.crypto) f.crypto = 500000;
        if(!f.mcx) f.mcx = 500000;
        if(!f.forex) f.forex = 500000;
        return f;
    }
    return { stock: 1000000, mcx: 500000, forex: 500000, crypto: 500000 };
  });
  
  const [brokerBalances, setBrokerBalances] = useState<Record<string, number>>({});
  const [paperPortfolio, setPaperPortfolio] = useState<PortfolioItem[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.PORTFOLIO);
    if (!saved) return [];
    const parsed = JSON.parse(saved);
    return parsed.filter((p: any) => p.broker === 'PAPER').map((p: any) => ({...p, type: p.type || 'STOCK'}));
  });
  const [externalHoldings, setExternalHoldings] = useState<PortfolioItem[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.TRANSACTIONS);
    return saved ? JSON.parse(saved) : [];
  });
  const [history, setHistory] = useState<PortfolioHistoryPoint[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.HISTORY);
    return saved ? JSON.parse(saved) : [];
  });

  // UI STATE
  const [activeTab, setActiveTab] = useState<AssetType>('STOCK');
  const [pnlViewMode, setPnlViewMode] = useState<'MARKET' | 'BROKER'>('BROKER');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [recommendations, setRecommendations] = useState<StockRecommendation[]>([]);
  const [marketData, setMarketData] = useState<MarketData>({});
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [notification, setNotification] = useState<string | null>(null);
  const [analysisData, setAnalysisData] = useState<Record<string, HoldingAnalysis>>({});
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [activeBots, setActiveBots] = useState<{ [key: string]: boolean }>({ 'PAPER': true, 'DHAN': true, 'SHOONYA': true, 'BINANCE': true, 'COINDCX': true, 'COINSWITCH': true });
  const [marketBots, setMarketBots] = useState<{ [key in AssetType]: boolean }>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.MARKET_BOTS);
    return saved ? JSON.parse(saved) : { STOCK: true, MCX: true, FOREX: true, CRYPTO: true };
  });
  const [showBotMenu, setShowBotMenu] = useState(false);
  const [isTradeModalOpen, setIsTradeModalOpen] = useState(false);
  const [selectedStock, setSelectedStock] = useState<StockRecommendation | null>(null);
  const [tradeMode, setTradeMode] = useState<'BUY' | 'SELL'>('BUY');
  const [tradeModalBroker, setTradeModalBroker] = useState<string | undefined>(undefined);
  const [niftyList, setNiftyList] = useState<string[]>([]);
  const lastReportTimeRef = useRef<number>(0);

  const allHoldings = useMemo(() => [...paperPortfolio, ...externalHoldings], [paperPortfolio, externalHoldings]);

  // --- EFFECTS (Persistence, Auth, Sync, Bot) ---
  useEffect(() => localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings)), [settings]);
  useEffect(() => localStorage.setItem(STORAGE_KEYS.FUNDS, JSON.stringify(funds)), [funds]);
  useEffect(() => localStorage.setItem(STORAGE_KEYS.PORTFOLIO, JSON.stringify(paperPortfolio)), [paperPortfolio]);
  useEffect(() => localStorage.setItem(STORAGE_KEYS.TRANSACTIONS, JSON.stringify(transactions)), [transactions]);
  useEffect(() => localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(history)), [history]);
  useEffect(() => localStorage.setItem(STORAGE_KEYS.MARKET_BOTS, JSON.stringify(marketBots)), [marketBots]);

  const handleLogin = (u: UserProfile) => {
    localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(u));
    setUser(u);
  };

  const handleLogout = () => {
    if (confirm("Sign out?")) {
        localStorage.removeItem(STORAGE_KEYS.USER);
        setUser(null);
    }
  };

  const showNotification = (msg: string) => {
      setNotification(msg);
      setTimeout(() => setNotification(null), 3000);
  };

  const hasCredentials = useCallback((broker: string, s: AppSettings) => {
      if (broker === 'PAPER') return true;
      if (broker === 'DHAN') return !!(s.dhanClientId && s.dhanAccessToken);
      if (broker === 'SHOONYA') return !!(s.shoonyaUserId && s.shoonyaPassword);
      if (broker === 'BINANCE') return !!(s.binanceApiKey);
      if (broker === 'COINDCX') return !!(s.coindcxApiKey);
      if (broker === 'COINSWITCH') return !!(s.coinswitchApiKey);
      return false;
  }, []);

  const syncExternalPortfolios = useCallback(async () => {
      if (!user) return;
      const promises: Promise<PortfolioItem[]>[] = [];
      const balancePromises: Promise<{broker: string, amount: number}>[] = [];
      const { activeBrokers } = settings;

      activeBrokers.forEach(broker => {
          if (broker === 'PAPER') return;
          if (!hasCredentials(broker, settings)) return;
          balancePromises.push(fetchBrokerBalance(broker, settings).then(amount => ({ broker, amount })));
          if (broker === 'DHAN') promises.push(fetchDhanHoldings(settings).catch(e => []));
          else if (broker === 'SHOONYA') promises.push(fetchShoonyaHoldings(settings).catch(e => []));
          else if (broker === 'BINANCE') promises.push(fetchBinanceHoldings(settings).catch(e => []));
          else if (broker === 'COINDCX') promises.push(fetchCoinDCXHoldings(settings).catch(e => []));
          else if (broker === 'COINSWITCH') promises.push(fetchCoinSwitchHoldings(settings).catch(e => []));
      });

      if (balancePromises.length > 0) {
          Promise.all(balancePromises).then(results => {
              const balances: Record<string, number> = {};
              results.forEach(r => balances[r.broker] = r.amount);
              setBrokerBalances(prev => ({...prev, ...balances}));
          });
      }

      if (promises.length > 0) {
          const results = await Promise.all(promises);
          const newHoldings = results.flat();
          setExternalHoldings(prev => {
              const prevStr = JSON.stringify(prev);
              const newStr = JSON.stringify(newHoldings);
              return prevStr === newStr ? prev : newHoldings;
          });
      } else {
          setExternalHoldings([]);
      }
  }, [settings, user, hasCredentials]);

  useEffect(() => {
      if (!user) return;
      if (settings.activeBrokers.some(b => b !== 'PAPER')) {
          syncExternalPortfolios(); 
          const interval = setInterval(syncExternalPortfolios, 30000); 
          return () => clearInterval(interval);
      } else {
          setExternalHoldings([]);
      }
  }, [user, settings.activeBrokers, syncExternalPortfolios]);

  // Load Data
  const loadMarketData = useCallback(async () => {
    if (!user) return;
    setIsLoading(true);
    let stocksList = niftyList;
    if (stocksList.length === 0) {
        stocksList = await checkAndRefreshStockList();
        setNiftyList(stocksList);
    }
    const totalCap = settings.initialFunds.stock + settings.initialFunds.mcx + settings.initialFunds.forex + settings.initialFunds.crypto;
    const stocks = await fetchTopStockPicks(totalCap, stocksList, settings.enabledMarkets);
    setRecommendations(stocks);
    
    const initialMarketData: MarketData = {};
    const combinedPortfolio = [...paperPortfolio, ...externalHoldings]; 
    const allSymbols = new Set([...stocks.map(s => s.symbol), ...combinedPortfolio.map(p => p.symbol)]);

    const fetchPromises = Array.from(allSymbols).map(async (symbol) => {
        const realData = await fetchRealStockData(symbol, settings);
        if (realData) initialMarketData[symbol] = realData;
        else {
            const rec = stocks.find(s => s.symbol === symbol);
            const port = combinedPortfolio.find(p => p.symbol === symbol);
            const fallbackPrice = rec ? rec.currentPrice : (port ? port.avgCost : 100);
            const candles = generateFallbackHistory(fallbackPrice, 50);
            initialMarketData[symbol] = { price: fallbackPrice, change: 0, changePercent: 0, history: candles, technicals: analyzeStockTechnical(candles) };
        }
    });
    await Promise.all(fetchPromises);
    setMarketData(prev => ({...prev, ...initialMarketData}));
    setIsLoading(false);
  }, [settings, paperPortfolio, externalHoldings, niftyList, user]);

  useEffect(() => {
    loadMarketData();
    const interval = setInterval(loadMarketData, 60000); // 1 min refresh
    return () => clearInterval(interval);
  }, [user, loadMarketData]);

  // History Effect
  useEffect(() => {
      const totalValue = funds.stock + funds.mcx + funds.forex + funds.crypto + 
          allHoldings.reduce((acc, h) => acc + (marketData[h.symbol]?.price || h.avgCost) * h.quantity, 0);
      
      setHistory(prev => {
          const now = new Date();
          const timeLabel = `${now.getHours()}:${now.getMinutes()}`;
          const newPoint = { time: timeLabel, value: totalValue };
          if (prev.length > 0 && prev[prev.length - 1].time === timeLabel) return prev;
          const newHist = [...prev, newPoint].slice(-50); // Keep last 50 points
          return newHist;
      });
  }, [marketData, funds, allHoldings]);
  
  // Handlers
  const handleAnalysis = async () => {
      if (allHoldings.length === 0) { showNotification("Portfolio is empty!"); return; }
      setIsAnalyzing(true);
      showNotification("Analyzing Portfolio...");
      try {
          const results = await analyzeHoldings(allHoldings, marketData);
          const map: Record<string, HoldingAnalysis> = {};
          results.forEach(r => map[r.symbol] = r);
          setAnalysisData(map);
          showNotification("Analysis Complete!");
      } catch (e) { showNotification("Analysis failed."); } finally { setIsAnalyzing(false); }
  };
  
   const recordTransaction = (type: 'BUY' | 'SELL', symbol: string, quantity: number, price: number, broker: any, assetType: AssetType) => {
    const newTx: Transaction = { id: Math.random().toString(36).substr(2, 9), type, symbol, assetType, quantity, price, timestamp: Date.now(), broker };
    setTransactions(prev => [...prev, newTx]);
  };

  const inferAssetType = useCallback((symbol: string): AssetType => {
      const rec = recommendations.find(r => r.symbol === symbol);
      if (rec) return rec.type;
      const holding = allHoldings.find(h => h.symbol === symbol);
      if (holding) return holding.type;
      if (STATIC_MCX_LIST.includes(symbol)) return 'MCX';
      if (STATIC_FOREX_LIST.includes(symbol)) return 'FOREX';
      if (STATIC_CRYPTO_LIST.includes(symbol)) return 'CRYPTO';
      return 'STOCK';
  }, [recommendations, allHoldings]);

  const executeBrokerTrade = async (symbol: string, quantity: number, type: 'BUY' | 'SELL', price: number, broker: string, assetType: AssetType) => {
      if (!hasCredentials(broker, settings)) { showNotification(`${broker} Error: Credentials not configured.`); return; }
      
      let result;
      if (broker === 'DHAN') result = await placeDhanOrder(symbol, quantity, type, price, assetType, settings);
      else if (broker === 'SHOONYA') result = await placeShoonyaOrder(symbol, quantity, type, price, assetType, settings);
      else if (broker === 'BINANCE') result = await placeBinanceOrder(symbol, quantity, type, price, assetType, settings);
      else if (broker === 'COINDCX') result = await placeCoinDCXOrder(symbol, quantity, type, price, assetType, settings);
      else if (broker === 'COINSWITCH') result = await placeCoinSwitchOrder(symbol, quantity, type, price, assetType, settings);
      
      if (result && result.success) {
          recordTransaction(type, symbol, quantity, price, broker as any, assetType);
          syncExternalPortfolios();
          showNotification(`${broker}: ${type} ${symbol} Executed`);
      } else {
          showNotification(`${broker} Failed: ${result?.message || 'Unknown error'}`);
      }
  };

  const handleBuy = useCallback(async (symbol: string, quantity: number, price: number, broker: any) => {
      const assetType = inferAssetType(symbol);
      if (broker === 'PAPER') {
          let newFunds = { ...funds };
          const cost = quantity * price;
          
          if (assetType === 'STOCK' && funds.stock >= cost) newFunds.stock -= cost;
          else if (assetType === 'MCX' && funds.mcx >= cost) newFunds.mcx -= cost;
          else if (assetType === 'FOREX' && funds.forex >= cost) newFunds.forex -= cost;
          else if (assetType === 'CRYPTO' && funds.crypto >= cost) newFunds.crypto -= cost;
          else { showNotification("Insufficient Paper Funds"); return; }
          
          setFunds(newFunds);
          
          const existing = paperPortfolio.find(p => p.symbol === symbol);
          if (existing) {
               setPaperPortfolio(prev => prev.map(p => p.symbol === symbol ? { ...p, quantity: p.quantity + quantity, totalCost: p.totalCost + cost, avgCost: (p.totalCost + cost) / (p.quantity + quantity) } : p));
          } else {
               setPaperPortfolio(prev => [...prev, {symbol, type: assetType, quantity, avgCost: price, totalCost: cost, broker: 'PAPER'}]);
          }

          recordTransaction('BUY', symbol, quantity, price, 'PAPER', assetType);
          showNotification(`Paper: BUY ${symbol}`);
      } else {
          await executeBrokerTrade(symbol, quantity, 'BUY', price, broker, assetType);
      }
  }, [settings, funds, marketData, paperPortfolio, inferAssetType]);

  const handleSell = useCallback(async (symbol: string, quantity: number, price: number, broker: any) => {
      const assetType = inferAssetType(symbol);
      if (broker === 'PAPER') {
         const existing = paperPortfolio.find(p => p.symbol === symbol);
         if (!existing || existing.quantity < quantity) { showNotification("Insufficient Holdings"); return; }
         
         const proceeds = quantity * price;
         const newFunds = { ...funds };
         if (assetType === 'STOCK') newFunds.stock += proceeds;
         else if (assetType === 'MCX') newFunds.mcx += proceeds;
         else if (assetType === 'FOREX') newFunds.forex += proceeds;
         else if (assetType === 'CRYPTO') newFunds.crypto += proceeds;
         setFunds(newFunds);

         if (Math.abs(existing.quantity - quantity) < 0.0001) {
             setPaperPortfolio(prev => prev.filter(p => p.symbol !== symbol));
         } else {
             setPaperPortfolio(prev => prev.map(p => p.symbol === symbol ? { ...p, quantity: p.quantity - quantity, totalCost: p.avgCost * (p.quantity - quantity) } : p));
         }

         recordTransaction('SELL', symbol, quantity, price, 'PAPER', assetType);
         showNotification(`Paper: SELL ${symbol}`);
      } else {
          await executeBrokerTrade(symbol, quantity, 'SELL', price, broker, assetType);
      }
  }, [paperPortfolio, settings, funds, inferAssetType]);


  const toggleBot = (broker: string) => setActiveBots(prev => ({...prev, [broker]: !prev[broker]}));
  const toggleMarketBot = (market: AssetType) => setMarketBots(prev => ({...prev, [market]: !prev[market]}));

  const manualSendTelegram = async () => {
    if (!settings.telegramBotToken) { showNotification("Config Telegram first."); return; }
    showNotification("Sending report...");
    await sendTelegramMessage(settings.telegramBotToken, settings.telegramChatId, generatePNLReport(allHoldings, funds, settings.initialFunds, marketData));
    showNotification("Report sent!");
  };

  const openTradeModal = (stock: StockRecommendation, mode: 'BUY' | 'SELL', broker?: string) => {
      setSelectedStock(stock);
      setTradeModalBroker(broker);
      setIsTradeModalOpen(true);
  };

  // --- STATS ---
  const calculatePnlForType = (type: AssetType, currentCash: number, initialFund: number) => {
      const typeHoldings = allHoldings.filter(h => h.type === type);
      const currentVal = typeHoldings.reduce((acc, item) => acc + ((marketData[item.symbol]?.price || item.avgCost) * item.quantity), 0);
      const pnl = (currentCash + currentVal) - initialFund;
      return { pnl, percent: initialFund > 0 ? (pnl / initialFund) * 100 : 0 };
  };
  const stockStats = calculatePnlForType('STOCK', funds.stock, settings.initialFunds.stock);
  const mcxStats = calculatePnlForType('MCX', funds.mcx, settings.initialFunds.mcx);
  const forexStats = calculatePnlForType('FOREX', funds.forex, settings.initialFunds.forex);
  const cryptoStats = calculatePnlForType('CRYPTO', funds.crypto, settings.initialFunds.crypto || 500000);

  const brokerStats = useMemo(() => settings.activeBrokers.map(broker => {
       const brokerHoldings = allHoldings.filter(h => h.broker === broker);
       
       const currentVal = brokerHoldings.reduce((acc, item) => {
            const price = marketData[item.symbol]?.price || item.avgCost;
            return acc + (price * item.quantity);
       }, 0);
       const totalCost = brokerHoldings.reduce((acc, item) => acc + item.totalCost, 0);
       const pnl = currentVal - totalCost;

       return { broker, pnl, percent: totalCost > 0 ? (pnl / totalCost) * 100 : 0, active: brokerHoldings.length, cash: brokerBalances[broker] || 0 };
  }), [allHoldings, funds, settings, brokerBalances, marketData]);

  const totalPL = stockStats.pnl + mcxStats.pnl + forexStats.pnl + cryptoStats.pnl;
  const totalInitial = settings.initialFunds.stock + settings.initialFunds.mcx + settings.initialFunds.forex + (settings.initialFunds.crypto || 500000);
  const totalCashPaper = funds.stock + funds.mcx + funds.forex + funds.crypto;
  const totalCashBroker = Object.values(brokerBalances).reduce((a: number, b: number) => a + b, 0);

  const visibleRecommendations = recommendations.filter(r => r.type === activeTab);

  if (!user) return <AuthOverlay onLogin={handleLogin} />;

  // --- COMPONENT SECTIONS FOR REUSE ---

  const renderFundsCard = () => (
    <div className="bg-surface p-4 md:p-6 rounded-2xl border border-slate-800 shadow-lg relative overflow-hidden">
      <div className="absolute top-0 right-0 p-4 opacity-10"><Wallet size={64} /></div>
      <h3 className="text-slate-400 text-xs md:text-sm font-medium uppercase tracking-wider mb-3">Liquidity / Funds</h3>
      <div className="grid grid-cols-2 gap-2 mb-4">
           <div className="bg-slate-800/50 p-2 rounded"><span className="text-[10px] text-slate-400 block">Equity</span><span className="font-mono text-xs font-bold">₹{(funds.stock/1000).toFixed(1)}k</span></div>
           <div className="bg-slate-800/50 p-2 rounded"><span className="text-[10px] text-slate-400 block">Crypto</span><span className="font-mono text-xs font-bold">₹{(funds.crypto/1000).toFixed(1)}k</span></div>
      </div>
      <div className="flex justify-between items-end border-t border-slate-700 pt-2">
          <span className="text-xs text-slate-500">Total Liquid</span>
          <span className="text-lg md:text-xl font-bold text-white font-mono">₹{(totalCashPaper + totalCashBroker).toLocaleString()}</span>
      </div>
    </div>
  );

  const renderPnLCard = () => (
    <div className="bg-surface p-4 md:p-6 rounded-2xl border border-slate-800 shadow-lg relative overflow-hidden flex flex-col h-full">
        <div className="absolute top-0 right-0 p-4 opacity-10"><TrendingUp size={64} /></div>
        <div className="flex justify-between items-center mb-4">
             <h3 className="text-slate-400 text-xs md:text-sm font-medium uppercase tracking-wider">P&L Analysis</h3>
             <div className="flex bg-slate-900 rounded p-0.5">
                 <button onClick={() => setPnlViewMode('MARKET')} className={`px-2 py-0.5 text-[10px] rounded font-bold ${pnlViewMode === 'MARKET' ? 'bg-blue-600 text-white' : 'text-slate-500'}`}>Market</button>
                 <button onClick={() => setPnlViewMode('BROKER')} className={`px-2 py-0.5 text-[10px] rounded font-bold ${pnlViewMode === 'BROKER' ? 'bg-blue-600 text-white' : 'text-slate-500'}`}>Broker</button>
             </div>
        </div>
        <div className="space-y-2 flex-1 overflow-y-auto custom-scrollbar max-h-40">
            {pnlViewMode === 'MARKET' ? (
                [{ label: 'Equity', ...stockStats, icon: <BarChart3 size={12}/> }, { label: 'Crypto', ...cryptoStats, icon: <Cpu size={12}/> }].map(stat => (
                    <div key={stat.label} className="flex justify-between items-center text-xs p-2 bg-slate-800/30 rounded">
                        <span className="flex items-center gap-2 text-slate-300">{stat.icon} {stat.label}</span>
                        <span className={`font-mono font-bold ${stat.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>{stat.pnl >= 0 ? '+' : ''}₹{stat.pnl.toLocaleString(undefined, {maximumFractionDigits:0})}</span>
                    </div>
                ))
            ) : (
                brokerStats.map(stat => (
                     <div key={stat.broker} className="flex justify-between items-center text-xs p-2 bg-slate-800/30 rounded">
                        <span className="flex items-center gap-2 text-slate-300"><Building2 size={12}/> {stat.broker}</span>
                        <span className={`font-mono font-bold ${stat.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>{stat.pnl >= 0 ? '+' : ''}₹{stat.pnl.toLocaleString(undefined, {maximumFractionDigits:0})}</span>
                    </div>
                ))
            )}
        </div>
        <div className="mt-auto pt-2 border-t border-slate-700 flex justify-between items-end">
            <span className="text-xs text-slate-500">Net P/L</span>
            <div className={`text-lg md:text-xl font-bold font-mono ${totalPL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {totalPL >= 0 ? '+' : ''}₹{totalPL.toLocaleString()}
            </div>
        </div>
    </div>
  );

  const renderMarketTabs = () => (
      <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar">
        {(['STOCK', 'MCX', 'FOREX', 'CRYPTO'] as AssetType[]).map(type => settings.enabledMarkets[type === 'STOCK' ? 'stocks' : type.toLowerCase() as any] && (
            <button key={type} onClick={() => setActiveTab(type)} className={`px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap transition-colors ${activeTab === type ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/30' : 'bg-slate-800 text-slate-400 border border-slate-700'}`}>
                {type}
            </button>
        ))}
      </div>
  );

  const renderStockList = () => (
      <div className="space-y-4 pb-20 md:pb-0">
          {isLoading ? [...Array(3)].map((_, i) => <div key={i} className="h-32 bg-surface rounded-xl border border-slate-800 animate-pulse" />) : (
             visibleRecommendations.length > 0 ? visibleRecommendations.map(stock => (
                 <StockCard key={stock.symbol} stock={stock} marketData={marketData} onTrade={(s) => openTradeModal(s, 'BUY')} />
             )) : <div className="p-8 text-center text-slate-500 bg-surface rounded-xl"><p>No picks available.</p></div>
          )}
      </div>
  );

  const renderBotControls = () => (
    <div className="bg-surface rounded-xl border border-slate-800 p-4">
       <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2"><Bot size={16}/> Auto-Trading Bots</h3>
       <div className="grid grid-cols-2 gap-2">
           {settings.activeBrokers.map(broker => (
               <button key={broker} onClick={() => toggleBot(broker)} className={`p-3 rounded-lg text-xs font-bold flex flex-col items-center gap-2 border transition-all ${activeBots[broker] ? 'bg-blue-600/20 border-blue-500 text-blue-300' : 'bg-slate-800 border-slate-700 text-slate-400'}`}>
                   <span>{broker}</span>
                   {activeBots[broker] ? <div className="flex items-center gap-1 text-[10px] text-green-400"><div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse"/> Active</div> : <span className="text-[10px]">Paused</span>}
               </button>
           ))}
       </div>
    </div>
  );

  // --- RENDER MAIN LAYOUT ---

  return (
    <div className="min-h-screen bg-background text-slate-100 font-sans pb-24 md:pb-8">
      
      {/* Top Navbar */}
      <nav className="sticky top-0 z-40 bg-slate-900/90 backdrop-blur-md border-b border-slate-800 safe-top">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex items-center justify-between h-14 md:h-16">
            <div className="flex items-center gap-2">
              <div className="bg-blue-600 p-1.5 md:p-2 rounded-lg"><BarChart3 size={18} className="text-white" /></div>
              <span className="text-lg md:text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-blue-200">AI-Trade Pro</span>
            </div>
            <div className="flex items-center gap-3">
               {/* Install PWA Button (Desktop) */}
               <div className="hidden md:block">
                  <InstallPWA />
               </div>

               {/* Desktop Only Menu Items */}
               <div className="hidden md:flex items-center gap-3">
                   <button onClick={() => setShowBotMenu(!showBotMenu)} className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-800 border border-slate-700 text-slate-300 text-xs font-bold hover:bg-slate-700"><Bot size={14} /> Bots</button>
                   <button onClick={manualSendTelegram} className="p-2 text-slate-400 hover:text-blue-400"><Send size={18} /></button>
                   <button onClick={() => setIsSettingsOpen(true)} className="p-2 text-slate-400 hover:text-white"><Settings size={18} /></button>
               </div>
               {/* Mobile Profile / Settings Shortcuts */}
               <div className="flex items-center gap-2">
                   <img src={user.picture || "https://ui-avatars.com/api/?name=User&background=random"} alt="User" className="w-7 h-7 md:w-8 md:h-8 rounded-full border border-slate-600" />
                   <button onClick={handleLogout} className="md:hidden text-slate-400 p-1"><LogOut size={16}/></button>
               </div>
            </div>
          </div>
        </div>
      </nav>

      {/* Notifications */}
      {notification && (
          <div className="fixed top-16 left-4 right-4 md:left-auto md:right-4 md:w-auto z-50 bg-slate-800 text-white px-4 py-3 rounded-xl shadow-xl border border-slate-700 flex items-center gap-3 animate-slide-up md:animate-fade-in">
              <AlertCircle size={18} className="text-blue-400 flex-shrink-0" />
              <span className="text-xs md:text-sm font-medium">{notification}</span>
          </div>
      )}

      <main className="max-w-7xl mx-auto px-4 py-4 md:py-8">
        
        {/* === MOBILE VIEW (Tabs) === */}
        <div className="md:hidden space-y-4">
            {mobileTab === 'HOME' && (
                <div className="space-y-4 animate-fade-in">
                    {renderFundsCard()}
                    {renderPnLCard()}
                    <div className="bg-surface rounded-2xl border border-slate-800 p-4 shadow-lg">
                        <h3 className="text-xs font-medium text-slate-400 uppercase mb-4">Performance</h3>
                        <PortfolioChart data={history} baseline={totalInitial} />
                    </div>
                </div>
            )}

            {mobileTab === 'MARKET' && (
                <div className="space-y-4 animate-fade-in">
                    <div className="flex justify-between items-center">
                        <h2 className="text-lg font-bold text-white">Market</h2>
                        <button onClick={loadMarketData} className="p-2 bg-slate-800 rounded-full text-slate-400"><RefreshCw size={14}/></button>
                    </div>
                    {renderMarketTabs()}
                    {renderStockList()}
                </div>
            )}

            {mobileTab === 'PORTFOLIO' && (
                <div className="space-y-4 animate-fade-in pb-20">
                    <div className="flex justify-between items-center">
                        <h2 className="text-lg font-bold text-white">Holdings <span className="text-sm font-normal text-slate-500">({allHoldings.length})</span></h2>
                        <button onClick={handleAnalysis} disabled={isAnalyzing} className="px-3 py-1.5 bg-purple-600 rounded-lg text-xs font-bold flex items-center gap-1 text-white">{isAnalyzing ? <RefreshCw className="animate-spin" size={12}/> : <Sparkles size={12}/>} AI Analyze</button>
                    </div>
                    {/* Compact Mobile List View for Portfolio could be here, reusing Table for now but check overflow */}
                    <PortfolioTable portfolio={allHoldings} marketData={marketData} analysisData={analysisData} onSell={(s, b) => { const st = recommendations.find(r=>r.symbol===s) || {symbol:s} as any; openTradeModal(st, 'SELL', b);}} />
                </div>
            )}

            {mobileTab === 'MORE' && (
                <div className="space-y-4 animate-fade-in pb-20">
                    <div className="flex justify-center pb-2">
                        <InstallPWA />
                    </div>
                    {renderBotControls()}
                    <ActivityFeed transactions={transactions} />
                    <button onClick={() => setIsSettingsOpen(true)} className="w-full py-4 bg-slate-800 rounded-xl border border-slate-700 text-slate-300 font-bold flex items-center justify-center gap-2">
                        <Settings size={18} /> Open Settings
                    </button>
                    <button onClick={manualSendTelegram} className="w-full py-4 bg-slate-800 rounded-xl border border-slate-700 text-blue-400 font-bold flex items-center justify-center gap-2">
                        <Send size={18} /> Test Telegram
                    </button>
                    <button onClick={handleLogout} className="w-full py-4 bg-red-900/20 rounded-xl border border-red-900/50 text-red-400 font-bold flex items-center justify-center gap-2">
                        <LogOut size={18} /> Sign Out
                    </button>
                </div>
            )}
        </div>

        {/* === DESKTOP VIEW (Grid) === */}
        <div className="hidden md:block space-y-8">
            <div className="grid grid-cols-3 gap-6">
                {renderFundsCard()}
                {renderPnLCard()}
                <div className="bg-surface p-6 rounded-2xl border border-slate-800 shadow-lg relative overflow-hidden">
                     <div className="absolute top-0 right-0 p-4 opacity-10"><PieChart size={64} /></div>
                    <h3 className="text-slate-400 text-sm font-medium uppercase tracking-wider mb-2">Positions</h3>
                    <div className="text-3xl font-bold text-white font-mono">{allHoldings.length}</div>
                    <p className="text-xs text-slate-500 mt-2">Active across {Object.values(settings.enabledMarkets).filter(Boolean).length} markets</p>
                </div>
            </div>

            <div>
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xl font-bold text-white">Open Positions</h2>
                    <button onClick={handleAnalysis} disabled={isAnalyzing} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold disabled:opacity-50 transition-colors">{isAnalyzing ? <RefreshCw className="animate-spin" size={14}/> : <Sparkles size={14} />} Analyze Portfolio</button>
                </div>
                <PortfolioTable portfolio={allHoldings} marketData={marketData} analysisData={analysisData} onSell={(s, b) => { const st = recommendations.find(r=>r.symbol===s) || {symbol:s} as any; openTradeModal(st, 'SELL', b);}} />
            </div>

            <div className="grid grid-cols-3 gap-8">
                <div className="col-span-1 space-y-6">
                    <div className="flex items-center justify-between">
                       {renderMarketTabs()}
                       <button onClick={loadMarketData} className="text-slate-500 hover:text-blue-400"><RefreshCw size={18} /></button>
                    </div>
                    {renderStockList()}
                </div>
                <div className="col-span-2 space-y-8">
                    <div>
                        <h2 className="text-xl font-bold text-white mb-4">Portfolio Value</h2>
                        <PortfolioChart data={history} baseline={totalInitial} />
                    </div>
                    <ActivityFeed transactions={transactions} />
                </div>
            </div>
        </div>

      </main>

      {/* MOBILE BOTTOM NAVIGATION */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 bg-slate-900/95 backdrop-blur-md border-t border-slate-800 pb-safe z-50">
          <div className="flex justify-around items-center h-16">
              <button onClick={() => setMobileTab('HOME')} className={`flex flex-col items-center gap-1 w-full h-full justify-center ${mobileTab === 'HOME' ? 'text-blue-400' : 'text-slate-500'}`}>
                  <LayoutDashboard size={20} className={mobileTab === 'HOME' ? 'fill-blue-400/20' : ''}/>
                  <span className="text-[10px] font-medium">Home</span>
              </button>
              <button onClick={() => setMobileTab('MARKET')} className={`flex flex-col items-center gap-1 w-full h-full justify-center ${mobileTab === 'MARKET' ? 'text-blue-400' : 'text-slate-500'}`}>
                  <BarChart3 size={20} className={mobileTab === 'MARKET' ? 'fill-blue-400/20' : ''}/>
                  <span className="text-[10px] font-medium">Markets</span>
              </button>
              <button onClick={() => setMobileTab('PORTFOLIO')} className={`flex flex-col items-center gap-1 w-full h-full justify-center ${mobileTab === 'PORTFOLIO' ? 'text-blue-400' : 'text-slate-500'}`}>
                  <PieChart size={20} className={mobileTab === 'PORTFOLIO' ? 'fill-blue-400/20' : ''}/>
                  <span className="text-[10px] font-medium">Portfolio</span>
              </button>
              <button onClick={() => setMobileTab('MORE')} className={`flex flex-col items-center gap-1 w-full h-full justify-center ${mobileTab === 'MORE' ? 'text-blue-400' : 'text-slate-500'}`}>
                  <Menu size={20} />
                  <span className="text-[10px] font-medium">More</span>
              </button>
          </div>
      </div>

      {isSettingsOpen && <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} settings={settings} onSave={(s) => { setSettings(s); setIsSettingsOpen(false); if(JSON.stringify(s.initialFunds) !== JSON.stringify(settings.initialFunds)) setFunds(s.initialFunds); loadMarketData(); }} />}
      {selectedStock && <TradeModal isOpen={isTradeModalOpen} onClose={() => setIsTradeModalOpen(false)} stock={selectedStock} currentPrice={marketData[selectedStock.symbol]?.price || selectedStock.currentPrice} funds={funds} holdings={allHoldings.filter(p => p.symbol === selectedStock.symbol)} activeBrokers={settings.activeBrokers} initialBroker={tradeModalBroker as any} onBuy={(s, q, p, b) => handleBuy(s, q, p, b)} onSell={(s, q, p, b) => handleSell(s, q, p, b)} />}
    </div>
  );
}