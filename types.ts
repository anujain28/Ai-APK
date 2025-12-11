
export type AssetType = 'STOCK' | 'MCX' | 'FOREX' | 'CRYPTO';

export interface UserProfile {
  name: string;
  email: string;
  picture: string;
  sub: string; // Google ID
  isGuest?: boolean;
}

export interface Funds {
  stock: number;
  mcx: number;
  forex: number;
  crypto: number;
}

export interface StockRecommendation {
  symbol: string;
  name: string;
  type: AssetType;
  sector: string;
  currentPrice: number;
  reason: string;
  riskLevel: 'Low' | 'Medium' | 'High';
  targetPrice: number;
  lotSize: number;
}

export interface HoldingAnalysis {
  symbol: string;
  action: 'BUY' | 'HOLD' | 'SELL';
  reason: string;
  targetPrice: number;
  dividendYield: string;
  cagr: string;
}

export interface PortfolioItem {
  symbol: string;
  type: AssetType;
  quantity: number;
  avgCost: number;
  totalCost: number;
  broker: 'PAPER' | 'DHAN' | 'SHOONYA' | 'BINANCE' | 'COINDCX' | 'COINSWITCH';
  targets?: {
      t1: number; // 2x ATR
      t2: number; // 3x ATR
      t3: number; // 4x ATR
  };
}

export interface Transaction {
  id: string;
  type: 'BUY' | 'SELL';
  symbol: string;
  assetType: AssetType;
  quantity: number;
  price: number;
  timestamp: number;
  broker: 'PAPER' | 'DHAN' | 'SHOONYA' | 'BINANCE' | 'COINDCX' | 'COINSWITCH';
}

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TechnicalSignals {
  rsi: number;
  macd: { macd: number; signal: number; histogram: number };
  stoch: { k: number; d: number };
  adx: number;
  atr: number; 
  bollinger: { upper: number; middle: number; lower: number; percentB: number };
  ema: { ema9: number; ema21: number };
  obv: number;
  score: number;
  activeSignals: string[];
  signalStrength: 'STRONG BUY' | 'BUY' | 'HOLD' | 'SELL';
}

export interface StockData {
  price: number;
  change: number;
  changePercent: number;
  history: Candle[]; 
  technicals: TechnicalSignals;
}

export interface MarketData {
  [symbol: string]: StockData;
}

export interface PortfolioHistoryPoint {
  time: string;
  value: number;
}

export interface MarketSettings {
  stocks: boolean;
  mcx: boolean;
  forex: boolean;
  crypto: boolean;
}

export interface AutoTradeConfig {
  mode: 'PERCENTAGE' | 'FIXED';
  value: number; // Percentage (e.g., 5) or Fixed Amount (e.g., 10000)
}

export interface AppSettings {
  initialFunds: Funds;
  autoTradeConfig: AutoTradeConfig;
  telegramBotToken: string;
  telegramChatId: string;
  activeBrokers: ('PAPER' | 'DHAN' | 'SHOONYA' | 'BINANCE' | 'COINDCX' | 'COINSWITCH')[];
  enabledMarkets: MarketSettings;
  // Stock Brokers
  dhanClientId?: string;
  dhanAccessToken?: string;
  shoonyaUserId?: string;
  shoonyaPassword?: string;
  // Crypto Exchanges
  binanceApiKey?: string;
  binanceSecret?: string;
  coindcxApiKey?: string;
  coindcxSecret?: string;
  coinswitchApiKey?: string;
}
