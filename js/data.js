// ============================================================
// 交易时段看板 - 节假日、市场配置、宏观指标与 Float 调色盘
// 同时支持浏览器（挂到 window.THD）与 Node（module.exports，供单元测试使用）
//
// 数据来源：
//  - A股 2026：上海证券交易所 (上证公告〔2025〕45号)
//  - A股 2027：按国务院办公厅《关于2027年部分节假日安排的通知》推演
//    NOTE: 上交所 2027 年休市公告预计 2026 年 12 月下旬发布，发布后必须复核 aShare 条目
//  - 港股：香港交易所 2026 / 2027 年证券市场假期与半日市通告
//  - 日经：JPX 交易日历（2027 年为法定假日推演）
//  - 韩股：KRX 交易日历（2027 年为法定假日与替代假日推演）
//  - 欧股：Xetra / 法兰克福交易所 2026 / 2027 交易日历
//  - 美股：NYSE 2026 / 2027 Holiday and Early Closings Calendar
//  - 黄金：CME / COMEX 假期安排（按美东日期）
//  - 原油：ICE Futures Europe 假期安排（按伦敦日期）
// 数据核实日期：2026-11-28
// ============================================================
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.THD = Object.assign(root.THD || {}, api);
  }
})(typeof self !== 'undefined' ? self : this, function () {
  // 本文件覆盖的年份（超出范围时页面会提示需更新日历）
  const DATA_YEARS = [2026, 2027];

  const HOLIDAYS = {
    // A股休市区间（闭区间，含周末自然休市）
    aShare: [
      ['2026-01-01', '2026-01-03'], // 元旦
      ['2026-02-15', '2026-02-23'], // 春节
      ['2026-04-04', '2026-04-06'], // 清明节
      ['2026-05-01', '2026-05-05'], // 劳动节
      ['2026-06-19', '2026-06-21'], // 端午节
      ['2026-09-25', '2026-09-27'], // 中秋节
      ['2026-10-01', '2026-10-07'], // 国庆节
      ['2027-01-01', '2027-01-03'], // 元旦
      ['2027-02-05', '2027-02-14'], // 春节（含 2 月 14 日周日调休上班日，A股照常休市）
      ['2027-04-03', '2027-04-05'], // 清明节
      ['2027-05-01', '2027-05-05'], // 劳动节
      ['2027-06-09', '2027-06-09'], // 端午节
      ['2027-09-15', '2027-09-15'], // 中秋节
      ['2027-10-01', '2027-10-07']  // 国庆节
    ],
    // 港股休市日（工作日）
    hk: [
      '2026-01-01', '2026-02-17', '2026-02-18', '2026-02-19',
      '2026-04-03', '2026-04-06', '2026-04-07', '2026-05-01',
      '2026-05-25', '2026-06-19', '2026-07-01', '2026-10-01',
      '2026-10-19', '2026-12-25',
      '2027-01-01', '2027-02-08', '2027-02-09', '2027-03-26',
      '2027-03-29', '2027-04-05', '2027-05-13', '2027-06-09',
      '2027-07-01', '2027-09-16', '2027-10-01', '2027-10-08',
      '2027-12-27'
    ],
    // 港股半日市（仅上午交易）
    hkHalf: ['2026-02-16', '2026-12-24', '2026-12-31', '2027-02-05', '2027-12-24', '2027-12-31'],
    // 日经/东交所休市日
    jp: [
      '2026-01-01', '2026-01-02', '2026-01-03', '2026-01-12',
      '2026-02-11', '2026-02-23', '2026-03-20', '2026-04-29',
      '2026-05-03', '2026-05-04', '2026-05-05', '2026-05-06',
      '2026-07-20', '2026-08-11', '2026-09-21', '2026-09-22',
      '2026-09-23', '2026-10-12', '2026-11-03', '2026-11-23',
      '2026-12-31',
      '2027-01-01', '2027-01-02', '2027-01-03', '2027-01-11',
      '2027-02-11', '2027-02-23', '2027-03-22', '2027-04-29',
      '2027-05-03', '2027-05-04', '2027-05-05', '2027-07-19',
      '2027-08-11', '2027-09-20', '2027-09-23', '2027-10-11',
      '2027-11-03', '2027-11-23', '2027-12-31'
    ],
    // 韩股休市日（KRX，工作日）
    kr: [
      '2026-01-01', '2026-02-16', '2026-02-17', '2026-02-18',
      '2026-03-02', '2026-05-01', '2026-05-05', '2026-05-25',
      '2026-06-03', '2026-07-17', '2026-08-17', '2026-09-24',
      '2026-09-25', '2026-10-05', '2026-10-09', '2026-12-25',
      '2026-12-31',
      '2027-01-01', '2027-02-08', '2027-02-09', '2027-03-01',
      '2027-05-03', '2027-05-05', '2027-05-13', '2027-07-19',
      '2027-08-16', '2027-09-14', '2027-09-15', '2027-09-16',
      '2027-10-04', '2027-10-11', '2027-12-27', '2027-12-31'
    ],
    // 欧股 XETRA（法兰克福）休市日（欧洲中部日期）
    eu: [
      '2026-01-01', '2026-04-03', '2026-04-06', '2026-12-24', '2026-12-25', '2026-12-31',
      '2027-01-01', '2027-03-26', '2027-03-29', '2027-12-24', '2027-12-31'
    ],
    // 美股全休市日（NYSE，美东日期）
    us: [
      '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03',
      '2026-05-25', '2026-06-19', '2026-07-03', '2026-09-07',
      '2026-11-26', '2026-12-25',
      '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26',
      '2027-05-31', '2027-06-18', '2027-07-05', '2027-09-06',
      '2027-11-25', '2027-12-24'
    ],
    // 美股提前收盘日（1:00 pm ET）
    usEarly: ['2026-11-27', '2026-12-24', '2027-11-26'],
    // CME / COMEX 黄金全休市日（美东日期）
    gold: ['2026-01-01', '2026-04-03', '2026-12-25', '2027-01-01', '2027-03-26', '2027-12-24'],
    // ICE 布伦特原油全休市日（伦敦日期）
    brent: ['2026-01-01', '2026-04-03', '2026-12-25', '2027-01-01', '2027-03-26', '2027-12-27']
  };

  // A股休市区间对应的节日名称（与 HOLIDAYS.aShare 区间一一对应）
  const A_SHARE_HOLIDAY_NAMES = [
    [['2026-01-01', '2026-01-03'], '元旦'],
    [['2026-02-15', '2026-02-23'], '春节'],
    [['2026-04-04', '2026-04-06'], '清明节'],
    [['2026-05-01', '2026-05-05'], '劳动节'],
    [['2026-06-19', '2026-06-21'], '端午节'],
    [['2026-09-25', '2026-09-27'], '中秋节'],
    [['2026-10-01', '2026-10-07'], '国庆节'],
    [['2027-01-01', '2027-01-03'], '元旦'],
    [['2027-02-05', '2027-02-14'], '春节'],
    [['2027-04-03', '2027-04-05'], '清明节'],
    [['2027-05-01', '2027-05-05'], '劳动节'],
    [['2027-06-09', '2027-06-09'], '端午节'],
    [['2027-09-15', '2027-09-15'], '中秋节'],
    [['2027-10-01', '2027-10-07'], '国庆节']
  ];

  // 全屏时钟固定切换顺序（9 个市场）
  const MARKET_IDS = ['crypto', 'aShare', 'hk', 'jp', 'kr', 'eu', 'us', 'gold', 'brent'];

  // 市场配置。primaryCode 是全屏 Float 时钟及看板主行展示的核心指数
  const MARKETS = [
    {
      id: 'aShare', name: 'A股', sub: '沪深', clockTag: 'SSE · A股', primaryCode: '000001', floatDecimals: 0,
      quotes: [
        { label: '上证', secid: '1.000001', tencent: 'sh000001' },
        { label: '深证', secid: '0.399001', tencent: 'sz399001' },
        { label: '创业板', secid: '0.399006', tencent: 'sz399006' }
      ]
    },
    {
      id: 'hk', name: '港股', sub: 'HKEX', clockTag: 'HKEX · HSI', primaryCode: 'HSI', floatDecimals: 0,
      quotes: [
        { label: '恒生', secid: '100.HSI', tencent: 'hkHSI' },
        { label: '恒生科技', secid: '124.HSTECH', tencent: 'hkHSTECH' }
      ]
    },
    {
      id: 'jp', name: '日股', sub: 'JPX', clockTag: 'JPX · N225', primaryCode: 'N225', floatDecimals: 0,
      quotes: [{ label: '日经225', secid: '100.N225', etf: 'sh513880', base: 56436.65 }]
    },
    {
      id: 'kr', name: '韩股', sub: 'KRX', clockTag: 'KRX · KOSPI', primaryCode: 'KS11', floatDecimals: 0,
      quotes: [{ label: 'KOSPI', secid: '100.KS11', etf: 'hk03121', base: 4708.54 }]
    },
    {
      id: 'eu', name: '欧股', sub: 'XETRA / LSE', clockTag: 'EU · DAX', primaryCode: 'GDAXI', floatDecimals: 0,
      quotes: [
        { label: '德国DAX', secid: '100.GDAXI', prec: 2 },
        { label: '富时100', secid: '100.FTSE', prec: 2 }
      ]
    },
    {
      id: 'us', name: '美股', sub: 'NYSE / Nasdaq', clockTag: 'NASDAQ', primaryCode: 'NDX', floatDecimals: 0,
      quotes: [
        { label: '标普500', secid: '100.SPX', tencent: 'usINX' },
        { label: '纳斯达克', secid: '100.NDX', tencent: 'usNDX' },
        { label: '道琼斯', secid: '100.DJIA', tencent: 'usDJI' }
      ]
    },
    {
      id: 'crypto', name: '加密货币', sub: '', clockTag: 'BTC', primaryCode: 'BTC', floatDecimals: 0,
      quotes: [
        { label: 'BTC', code: 'BTC', binance: 'BTCUSDT' },
        { label: 'ETH', code: 'ETH', binance: 'ETHUSDT' }
      ]
    },
    {
      id: 'gold', name: '黄金', sub: 'COMEX / LBMA', clockTag: 'GOLD · COMEX', primaryCode: 'GC00Y', floatDecimals: 1,
      quotes: [
        { label: 'COMEX', secid: '101.GC00Y', tencentHf: 'hf_GC', emFut: '101_GC00Y_qt', prec: 1, decimals: 1 },
        { label: '伦敦金', secid: '122.XAU', tencentHf: 'hf_XAU', wscn: 'XAUUSD.OTC', prec: 2, decimals: 2 }
      ]
    },
    {
      id: 'brent', name: '原油', sub: 'ICE / NYMEX', clockTag: 'OIL · BRENT', primaryCode: 'B00Y', floatDecimals: 2,
      quotes: [
        { label: '布伦特', secid: '112.B00Y', tencentHf: 'hf_OIL', emFut: '112_B00Y_qt', prec: 2 },
        { label: 'WTI', secid: '102.CL00Y', tencentHf: 'hf_CL', emFut: '102_CL00Y_qt', prec: 2 }
      ]
    }
  ];

  // 顶部宏观风向标条（4 项跨资产核心宏观锚，大陆免 VPN 直连）
  const MACRO_ITEMS = [
    { label: '美债10Y', code: 'US10Y', secid: '171.US10Y', wscn: 'US10YR.OTC', prec: 4, decimals: 3, suffix: '%' },
    { label: '美元指数', code: 'UDI', secid: '100.UDI', prec: 2, decimals: 2 },
    { label: '离岸人民币', code: 'USDCNH', secid: '133.USDCNH', prec: 4, decimals: 4 },
    { label: 'VIX恐慌', code: 'VIX', wscn: 'VIX.OTC', decimals: 2 }
  ];

  // 状态元信息
  const STATUS_META = {
    open:     { label: '交易中', cls: 'st-open' },
    lunch:    { label: '午休', cls: 'st-lunch' },
    pre:      { label: '盘前', cls: 'st-pre' },
    post:     { label: '盘后', cls: 'st-post' },
    overnight:{ label: '隔夜', cls: 'st-overnight' },
    weekend:  { label: '周末休市', cls: 'st-weekend' },
    holiday:  { label: '休市', cls: 'st-holiday' }
  };

  // iOS StandBy Float 调色盘（规格书第 3 节）
  const FLOAT_PALETTES = [
    { id: 'classic-blue',    name: '经典蔚蓝', colors: ['#5494EA', '#1A56B8', '#5494EA', '#1A56B8'], preview: ['#5494EA', '#1A56B8'] },
    { id: 'blue-mint',       name: '蓝绿波普', colors: ['#0560BE', '#65DC84', '#549FF8', '#248A5E'], preview: ['#549FF8', '#65DC84'] },
    { id: 'blue-orange',     name: '蓝橙撞色', colors: ['#569DF5', '#FF9E44', '#0A62C4', '#B85A14'], preview: ['#0A62C4', '#FF9E44'] },
    { id: 'violet-magenta',  name: '紫粉霓虹', colors: ['#4928B8', '#E26EC7', '#7C54F6', '#9E3686'], preview: ['#7C54F6', '#E26EC7'] },
    { id: 'coral-sun',       name: '珊瑚暖阳', colors: ['#D9483B', '#FFDA4E', '#FF7B72', '#C98A18'], preview: ['#FF7B72', '#FFDA4E'] },
    { id: 'watermelon-cyan', name: '西瓜青柠', colors: ['#B53156', '#49D5DF', '#F4648A', '#1B8B96'], preview: ['#F4648A', '#49D5DF'] }
  ];

  return { DATA_YEARS, HOLIDAYS, A_SHARE_HOLIDAY_NAMES, MARKET_IDS, MARKETS, MACRO_ITEMS, STATUS_META, FLOAT_PALETTES };
});
