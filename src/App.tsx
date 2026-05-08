import React, { useState, useEffect, useRef } from 'react';
import { Search, ShoppingCart, Plus, Minus, X, Info, Image as ImageIcon, FileText, History, Printer, Trash, Save, ArrowUp, Users, CalendarDays, ClipboardList, UserPlus, Phone, Mail, MapPin, CheckCircle2, Clock3, Camera, Network, ShieldAlert, Zap, Package, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { toast, Toaster } from 'sonner';

import { QuoteDocument } from './components/QuoteDocument';
import { calculateMargin, calculateSubtotal as getQuoteSubtotal, calculateTotalCostDisplay as getTotalCostDisplay, formatSyscomPrice } from './pricing';
import type { Product, QuoteItem, QuoteHistoryItem, ClientRecord, MeetingRecord } from './types';

export default function App() {
  const [searchTerm, setSearchTerm] = useState('tecnopatch');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<Product[]>([]);
  const [quoteItems, setQuoteItems] = useState<QuoteItem[]>([]);
  const [exchangeRate, setExchangeRate] = useState<number>(18.00);
  const [includeIva, setIncludeIva] = useState(true);
  const [quoteHistory, setQuoteHistory] = useState<QuoteHistoryItem[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showMobileCart, setShowMobileCart] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [appReady, setAppReady] = useState(false);
  const [isConfirmingEmpty, setIsConfirmingEmpty] = useState(false);
  const [currency, setCurrency] = useState<'MXN' | 'USD'>('MXN');

  // Customer Details & Project Settings
  const [clientName, setClientName] = useState('');
  const [clientCompany, setClientCompany] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [projectType, setProjectType] = useState('Residencial');
  const [projectScope, setProjectScope] = useState('');
  const [manualTitle, setManualTitle] = useState('');
  const [manualCategory, setManualCategory] = useState('Material');
  const [manualUnit, setManualUnit] = useState('pz');
  const [manualQuantity, setManualQuantity] = useState(1);
  const [manualUnitPrice, setManualUnitPrice] = useState(0);
  const [activeModule, setActiveModule] = useState<'cotizador' | 'clientes' | 'citas' | 'seguimiento'>('cotizador');
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [meetings, setMeetings] = useState<MeetingRecord[]>([]);
  const [quoteStatus, setQuoteStatus] = useState<'Borrador' | 'Enviada' | 'Seguimiento' | 'Aceptada' | 'Rechazada'>('Borrador');
  const [salesRep, setSalesRep] = useState('TecnoPatch Ventas');
  const [validityDays, setValidityDays] = useState(15);
  const [advancePercent, setAdvancePercent] = useState(60);
  const [paymentTerms, setPaymentTerms] = useState('60% anticipo, 40% contra entrega');
  const [newClient, setNewClient] = useState({
    name: '',
    company: '',
    phone: '',
    email: '',
    address: '',
    source: 'WhatsApp',
    status: 'Prospecto' as ClientRecord['status'],
    owner: 'Ventas',
    notes: ''
  });
  const [newMeeting, setNewMeeting] = useState({
    clientId: '',
    title: '',
    date: '',
    time: '',
    type: 'Visita tecnica' as MeetingRecord['type'],
    owner: 'Ventas',
    location: '',
    status: 'Programada' as MeetingRecord['status'],
    notes: ''
  });

  // Pricing Strategy
  const [marginPercent, setMarginPercent] = useState(30);
  const [showModelsInPdf, setShowModelsInPdf] = useState(true);
  const [isInitialState, setIsInitialState] = useState(true);

  // Filter & UI State
  const [sortBy, setSortBy] = useState<'precio_asc' | 'precio_desc' | 'nombre_asc' | 'nombre_desc' | 'existencia_desc' | 'default'>('default');
  const [selectedBrand, setSelectedBrand] = useState('Todas');
  const [brands, setBrands] = useState<string[]>([]);
  const [activeCategory, setActiveCategory] = useState<string>('');
  const leftSectionRef = useRef<HTMLElement>(null);
  const quoteNumber = useRef(`COT-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`).current;
  const syscomItemCount = quoteItems.filter(item => !item.product.isManual).length;
  const manualItemCount = quoteItems.filter(item => item.product.isManual).length;
  const quoteUnitCount = quoteItems.reduce((acc, item) => acc + item.quantity, 0);
  const pipelineTotal = quoteHistory.reduce((acc, quote) => acc + (quote.total || 0), 0);
  const pendingMeetings = meetings.filter(meeting => meeting.status === 'Programada' || meeting.status === 'Reagendada');
  const activeClients = clients.filter(client => client.status !== 'Pausado');
  const todayIso = new Date().toISOString().slice(0, 10);
  const todayMeetings = meetings.filter(meeting => meeting.date === todayIso);
  const moduleTabs = [
    { id: 'cotizador', label: 'Cotizador', icon: ShoppingCart },
    { id: 'clientes', label: 'Clientes', icon: Users },
    { id: 'citas', label: 'Citas', icon: CalendarDays },
    { id: 'seguimiento', label: 'Seguimiento', icon: ClipboardList }
  ] as const;
  const manualTemplates = [
    { label: 'Tuberia', title: 'Tuberia conduit 3/4', category: 'Material', unit: 'm', quantity: 1 },
    { label: 'Cable UTP', title: 'Cable UTP Cat6', category: 'Material', unit: 'm', quantity: 1 },
    { label: 'Mano de obra', title: 'Mano de obra de instalacion', category: 'Mano de obra', unit: 'servicio', quantity: 1 },
    { label: 'Configuracion', title: 'Configuracion y puesta en marcha', category: 'Configuracion', unit: 'servicio', quantity: 1 },
    { label: 'Obra civil', title: 'Obra civil / canalizacion', category: 'Obra civil', unit: 'servicio', quantity: 1 },
    { label: 'Viaticos', title: 'Viaticos y traslado', category: 'Servicio', unit: 'servicio', quantity: 1 }
  ];

  useEffect(() => {
    // Scroll listener for sticky header
    const container = leftSectionRef.current;
    const handleScroll = () => {
      if (container) {
        setScrolled(container.scrollTop > 150);
      }
    };

    if (container) {
      container.addEventListener('scroll', handleScroll);
    }

    // Initial Loading
    const savedHistory = localStorage.getItem('quoteHistory');
    if (savedHistory) setQuoteHistory(JSON.parse(savedHistory));

    const savedClients = localStorage.getItem('crmClients');
    if (savedClients) setClients(JSON.parse(savedClients));

    const savedMeetings = localStorage.getItem('crmMeetings');
    if (savedMeetings) setMeetings(JSON.parse(savedMeetings));

    const savedCurrent = localStorage.getItem('currentQuote');
    if (savedCurrent) {
      const data = JSON.parse(savedCurrent);
      setQuoteItems(data.items || []);
      setClientName(data.clientName || '');
      setClientCompany(data.clientCompany || '');
      setClientPhone(data.clientPhone || '');
      setClientEmail(data.clientEmail || '');
      setProjectType(data.projectType || 'Residencial');
      setProjectScope(data.projectScope || '');
      setMarginPercent(data.marginPercent || 30);
      setIncludeIva(data.includeIva !== undefined ? data.includeIva : true);
      setCurrency(data.currency || 'MXN');
      setShowModelsInPdf(data.showModelsInPdf !== undefined ? data.showModelsInPdf : true);
      setQuoteStatus(data.quoteStatus || 'Borrador');
      setSalesRep(data.salesRep || 'TecnoPatch Ventas');
      setValidityDays(data.validityDays || 15);
      setAdvancePercent(data.advancePercent || 60);
      setPaymentTerms(data.paymentTerms || '60% anticipo, 40% contra entrega');
    }

    // Always scroll to top on reload if there's no hash
    leftSectionRef.current?.scrollTo(0, 0);

    const fetchExchangeRate = async () => {
      try {
        const res = await fetch('/api/syscom/exchange');
        const data = await res.json();
        if (data && data.normal) setExchangeRate(parseFloat(data.normal));
      } catch (error) {
        console.error("Error fetching exchange rate:", error);
      }
    };
    fetchExchangeRate();
    // fetchProducts(searchTerm); <--- Removed to prevent "No products found" on early load

    // Simulate App Loading/Splash
    const timer = setTimeout(() => {
      setAppReady(true);
    }, 1500);

    return () => {
      clearTimeout(timer);
      if (container) {
        container.removeEventListener('scroll', handleScroll);
      }
    };
  }, []);

  // Save current quote state to localStorage on every change
  useEffect(() => {
    const currentQuote = {
      items: quoteItems,
      clientName,
      clientCompany,
      clientPhone,
      clientEmail,
      projectType,
      projectScope,
      marginPercent,
      includeIva,
      currency,
      showModelsInPdf,
      quoteStatus,
      salesRep,
      validityDays,
      advancePercent,
      paymentTerms
    };
    localStorage.setItem('currentQuote', JSON.stringify(currentQuote));
  }, [quoteItems, clientName, clientCompany, clientPhone, clientEmail, projectType, projectScope, marginPercent, includeIva, currency, showModelsInPdf, quoteStatus, salesRep, validityDays, advancePercent, paymentTerms]);

  useEffect(() => {
    localStorage.setItem('crmClients', JSON.stringify(clients));
  }, [clients]);

  useEffect(() => {
    localStorage.setItem('crmMeetings', JSON.stringify(meetings));
  }, [meetings]);

  // Update brands list when results change
  useEffect(() => {
    if (results.length > 0) {
      const uniqueBrands = Array.from(new Set(results.map(p => p.marca))).filter(Boolean).sort();
      setBrands(['Todas', ...uniqueBrands]);
    }
  }, [results]);

  // Handle scroll events
  useEffect(() => {
    const handleScroll = () => {
      setScrolled(leftSectionRef.current?.scrollTop! > 200);
    };
    leftSectionRef.current?.addEventListener('scroll', handleScroll);
    return () => leftSectionRef.current?.removeEventListener('scroll', handleScroll);
  }, []);


  // Lock body scroll when mobile cart is open
  useEffect(() => {
    if (showMobileCart) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => { document.body.style.overflow = 'unset'; };
  }, [showMobileCart]);

  const formatPrice = (usdAmount: number) => formatSyscomPrice(usdAmount, currency, exchangeRate, includeIva);

  const filteredResults = results
    .filter(p => selectedBrand === 'Todas' || p.marca === selectedBrand)
    .sort((a, b) => {
      if (sortBy === 'precio_asc') return parseFloat(a.precios.precio_1) - parseFloat(b.precios.precio_1);
      if (sortBy === 'precio_desc') return parseFloat(b.precios.precio_1) - parseFloat(a.precios.precio_1);
      if (sortBy === 'existencia_desc') return b.total_existencia - a.total_existencia;
      if (sortBy === 'nombre_asc') return a.titulo.localeCompare(b.titulo);
      if (sortBy === 'nombre_desc') return b.titulo.localeCompare(a.titulo);
      return 0; // default (order from API)
    });

  const fetchProducts = async (query: string) => {
    if (!query) return;
    setIsInitialState(false);
    setLoading(true);
    try {
      const res = await fetch(`/api/syscom/search?q=${encodeURIComponent(query)}`);
      const data = await res.json();

      if (data.error) {
        console.error("API Error:", data.error);
        toast.error(`Error de Syscom: ${data.error}`);
        setResults([]);
        return;
      }

      if (data.productos) {
        setResults(data.productos);
      } else {
        setResults([]);
      }
    } catch (error) {
      console.error(error);
      toast.error('Error fetching products from Syscom API');
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchTerm.trim()) {
      fetchProducts(searchTerm);
    }
  };

  const goHome = () => {
    setIsInitialState(true);
    setSearchTerm('');
    setResults([]);
    setActiveCategory('');
    leftSectionRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const addToQuote = (product: Product) => {
    setQuoteItems(current => {
      const existing = current.find(item => item.product.producto_id === product.producto_id);
      if (existing) {
        return current.map(item =>
          item.product.producto_id === product.producto_id
            ? { ...item, quantity: item.quantity + 1 }
            : item
        );
      }

      // Smart Margin Calculation
      // Formula: Costo / (1 - Margen%)
      const costUsd = parseFloat(product.precios.precio_descuento) || 0;
      const costMxn = costUsd * exchangeRate;
      const marginFactor = 1 - (marginPercent / 100);
      const unitPriceMxn = marginFactor > 0 ? (costMxn / marginFactor) : costMxn * 1.3;

      return [...current, { product, quantity: 1, unitPriceMxn }];
    });
    toast.success(`${product.modelo} added with ${marginPercent}% margin`);
  };

  const addManualItem = () => {
    const title = manualTitle.trim();
    if (!title) {
      toast.error('Agrega una descripcion para la partida manual');
      return;
    }

    if (manualQuantity <= 0 || manualUnitPrice < 0) {
      toast.error('Revisa cantidad y precio de la partida manual');
      return;
    }

    const unitPriceMxn = currency === 'USD' ? manualUnitPrice * exchangeRate : manualUnitPrice;
    const id = `manual-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const product: Product = {
      producto_id: id,
      modelo: manualCategory,
      total_existencia: 0,
      titulo: title,
      marca: 'Partida manual',
      img_portada: '',
      garantia: '',
      sat_key: '',
      sat_description: '',
      pvol: '',
      peso: '',
      alto: '',
      largo: '',
      ancho: '',
      link: '',
      precios: {
        precio_1: '0',
        precio_especial: '0',
        precio_descuento: '0',
        precio_lista: '0'
      },
      isManual: true,
      manualCategory,
      unit: manualUnit
    };

    setQuoteItems(current => [...current, { product, quantity: manualQuantity, unitPriceMxn }]);
    setManualTitle('');
    setManualQuantity(1);
    setManualUnitPrice(0);
    toast.success('Partida manual agregada');
  };

  const applyManualTemplate = (template: typeof manualTemplates[number]) => {
    setManualTitle(template.title);
    setManualCategory(template.category);
    setManualUnit(template.unit);
    setManualQuantity(template.quantity);
  };

  const createClient = () => {
    if (!newClient.name.trim() && !newClient.company.trim()) {
      toast.error('Agrega nombre o empresa del cliente');
      return;
    }

    const client: ClientRecord = {
      id: `client-${Date.now()}`,
      name: newClient.name.trim(),
      company: newClient.company.trim(),
      phone: newClient.phone.trim(),
      email: newClient.email.trim(),
      address: newClient.address.trim(),
      source: newClient.source,
      status: newClient.status,
      owner: newClient.owner.trim() || 'Ventas',
      notes: newClient.notes.trim(),
      createdAt: new Date().toLocaleString('es-MX')
    };

    setClients(current => [client, ...current]);
    setClientName(client.name || client.company);
    setClientCompany(client.company);
    setClientPhone(client.phone);
    setClientEmail(client.email);
    setNewClient({
      name: '',
      company: '',
      phone: '',
      email: '',
      address: '',
      source: 'WhatsApp',
      status: 'Prospecto',
      owner: 'Ventas',
      notes: ''
    });
    toast.success('Cliente agregado al CRM');
  };

  const useClientInQuote = (client: ClientRecord) => {
    setClientName(client.name || client.company);
    setClientCompany(client.company);
    setClientPhone(client.phone);
    setClientEmail(client.email);
    setProjectScope(current => current || (client.address ? `Direccion del proyecto: ${client.address}` : ''));
    setActiveModule('cotizador');
    toast.success('Cliente cargado en cotizacion');
  };

  const createMeeting = () => {
    const selectedClient = clients.find(client => client.id === newMeeting.clientId);
    const fallbackClientName = clientName || clientCompany;
    if (!selectedClient && !fallbackClientName) {
      toast.error('Selecciona un cliente o carga uno en la cotizacion');
      return;
    }
    if (!newMeeting.date || !newMeeting.time) {
      toast.error('Agrega fecha y hora de la cita');
      return;
    }

    const meeting: MeetingRecord = {
      id: `meeting-${Date.now()}`,
      clientId: selectedClient?.id || '',
      clientName: selectedClient ? (selectedClient.company || selectedClient.name) : fallbackClientName,
      title: newMeeting.title.trim() || newMeeting.type,
      date: newMeeting.date,
      time: newMeeting.time,
      type: newMeeting.type,
      owner: newMeeting.owner.trim() || salesRep,
      location: newMeeting.location.trim() || selectedClient?.address || '',
      status: newMeeting.status,
      notes: newMeeting.notes.trim()
    };

    setMeetings(current => [meeting, ...current].sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`)));
    setNewMeeting({
      clientId: '',
      title: '',
      date: '',
      time: '',
      type: 'Visita tecnica',
      owner: 'Ventas',
      location: '',
      status: 'Programada',
      notes: ''
    });
    toast.success('Cita programada');
  };

  const updateMeetingStatus = (id: string, status: MeetingRecord['status']) => {
    setMeetings(current => current.map(meeting => meeting.id === id ? { ...meeting, status } : meeting));
  };

  const applyGlobalMargin = (percent = marginPercent) => {
    setQuoteItems(current => current.map(item => {
      if (item.product.isManual) return item;
      const costUsd = parseFloat(item.product.precios.precio_descuento) || 0;
      const costMxn = costUsd * exchangeRate;
      const marginFactor = 1 - (percent / 100);
      const unitPriceMxn = marginFactor > 0 ? (costMxn / marginFactor) : costMxn * 1.3;
      return { ...item, unitPriceMxn };
    }));
    toast.info(`Applied ${percent}% margin to Syscom items`);
  };

  const updateQuantity = (id: string, delta: number) => {
    setQuoteItems(current =>
      current.map(item => {
        if (item.product.producto_id === id) {
          const newQuantity = Math.max(1, item.quantity + delta);
          return { ...item, quantity: newQuantity };
        }
        return item;
      })
    );
  };

  const updateItemPrice = (id: string, newPriceMxn: number) => {
    setQuoteItems(current =>
      current.map(item => {
        if (item.product.producto_id === id) {
          return { ...item, unitPriceMxn: isNaN(newPriceMxn) ? 0 : newPriceMxn };
        }
        return item;
      })
    );
  };

  const removeItem = (id: string) => {
    setQuoteItems(current => current.filter(item => item.product.producto_id !== id));
  };

  const calculateSubtotal = () => getQuoteSubtotal(quoteItems, currency, exchangeRate);
  const calculateTotalCostDisplay = () => getTotalCostDisplay(quoteItems, currency, exchangeRate, includeIva);

  const subtotal = calculateSubtotal();
  const tax = includeIva ? subtotal * 0.16 : 0;
  const total = subtotal + tax;

  // Revised calculations logic:
  // subtotal (NET)
  // tax (IVA if toggled)
  // total (Final price)
  // margin (selling subtotal - buying subtotal)

  const margin = calculateMargin(subtotal, calculateTotalCostDisplay(), includeIva);

  const saveQuoteToHistory = () => {
    if (quoteItems.length === 0) return;
    const newQuote: any = {
      id: Math.random().toString(36).substring(2, 9),
      quoteNumber,
      date: new Date().toLocaleString(),
      items: [...quoteItems],
      subtotal,
      tax,
      total,
      includeTax: includeIva,
      exchangeRate,
      clientName,
      clientCompany,
      clientPhone,
      clientEmail,
      projectType,
      projectScope,
      marginPercent,
      showModelsInPdf,
      quoteStatus,
      salesRep,
      validityDays,
      advancePercent,
      paymentTerms
    };
    const newHistory = [newQuote, ...quoteHistory].slice(0, 50); // keep last 50
    setQuoteHistory(newHistory);
    localStorage.setItem('quoteHistory', JSON.stringify(newHistory));
    toast.success('Quote saved to history!');
    setTimeout(() => window.print(), 500);
  };

  const deleteFromHistory = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const newHistory = quoteHistory.filter(h => h.id !== id);
    setQuoteHistory(newHistory);
    localStorage.setItem('quoteHistory', JSON.stringify(newHistory));
    toast.success('Cotizacion eliminada del historial');
  };

  const restoreQuote = (hist: any) => {
    setQuoteItems(hist.items);
    setIncludeIva(hist.includeTax);
    setClientName(hist.clientName || '');
    setClientCompany(hist.clientCompany || '');
    setClientPhone(hist.clientPhone || '');
    setClientEmail(hist.clientEmail || '');
    setProjectType(hist.projectType || 'Residencial');
    setProjectScope(hist.projectScope || '');
    setMarginPercent(hist.marginPercent || 30);
    setShowModelsInPdf(hist.showModelsInPdf !== undefined ? hist.showModelsInPdf : true);
    setQuoteStatus(hist.quoteStatus || hist.status || 'Borrador');
    setSalesRep(hist.salesRep || 'TecnoPatch Ventas');
    setValidityDays(hist.validityDays || 15);
    setAdvancePercent(hist.advancePercent || 60);
    setPaymentTerms(hist.paymentTerms || '60% anticipo, 40% contra entrega');
    setShowHistory(false);
    toast.info('Quote restored from history');
  };

  return (
    <>
      {!appReady ? (
        <div className="fixed inset-0 z-[100] bg-[#0f172a] flex flex-col items-center justify-center text-white">
          <div className="relative">
            <div className="w-24 h-24 bg-blue-600 rounded-3xl flex items-center justify-center font-black text-4xl shadow-2xl animate-bounce">T</div>
            <div className="absolute inset-0 w-24 h-24 bg-blue-600 rounded-3xl animate-ping opacity-20"></div>
          </div>
          <div className="mt-8 flex flex-col items-center gap-2">
            <h2 className="text-xl font-black tracking-tighter">TECNOPATCH <span className="text-blue-500">COTIZADOR</span></h2>
            <div className="w-32 h-1 bg-slate-800 rounded-full overflow-hidden">
              <div className="w-full h-full bg-blue-500 animate-[loading_1.5s_ease-in-out_infinite]"></div>
            </div>
          </div>
        </div>
      ) : (
        <div className="min-h-screen bg-slate-50 flex flex-col font-sans text-slate-900 animate-in fade-in duration-500">
          <div className="print:hidden flex flex-col min-h-screen">
            <Toaster position="top-right" richColors />

            {/* STICKY ACCESSIBILITY HEADER */}
            <div className={`fixed top-0 left-0 right-0 z-50 bg-slate-900 text-white shadow-2xl transition-all duration-300 transform ${scrolled ? 'translate-y-0 opacity-100' : '-translate-y-full opacity-0'}`}>
              <div className="max-w-[1920px] mx-auto px-4 md:px-6 py-2 md:py-3 flex items-center justify-between">
                <div className="flex items-center gap-3 md:gap-4">
                  <div className="w-7 h-7 md:w-8 md:h-8 bg-blue-600 rounded flex items-center justify-center font-bold text-[10px] md:text-xs">TP</div>
                  <div>
                    <p className="hidden xs:block text-[8px] md:text-[10px] text-slate-400 font-bold uppercase tracking-widest">Cotizacion Activa</p>
                    <p className="text-xs md:text-sm font-bold text-emerald-400">{total.toLocaleString('es-MX', { style: 'currency', currency: currency })}</p>
                  </div>
                </div>
                <div className="flex gap-2 md:gap-3">
                  <Button onClick={() => leftSectionRef.current?.scrollTo({ top: 0, behavior: 'smooth' })} variant="ghost" className="hidden sm:flex text-white hover:bg-white/10 h-8 md:h-9 px-2 md:px-3 text-[10px] md:text-xs">
                    Subir
                  </Button>
                  <Button onClick={saveQuoteToHistory} className="bg-blue-600 hover:bg-blue-700 text-white h-8 md:h-9 px-3 md:px-4 text-[10px] md:text-xs font-bold">
                    <Printer size={14} className="mr-1 md:mr-2" /> <span className="hidden xs:inline">Imprimir</span><span className="xs:hidden">PDF</span>
                  </Button>
                </div>
              </div>
            </div>

            {/* SCROLL TO TOP FLOATING BUTTON */}
            <div className="fixed bottom-6 right-6 z-[60] transition-all duration-300 ease-out">
              <button
                onClick={() => leftSectionRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
                className={`bg-blue-600 text-white p-3 rounded-full shadow-2xl hover:bg-blue-700 active:scale-95 transition-all duration-300 hover:scale-110 ${scrolled ? 'translate-y-0 opacity-100 pointer-events-auto' : 'translate-y-20 opacity-0 pointer-events-none'}`}
                aria-label="Volver arriba"
                title="Volver arriba"
              >
                <ArrowUp size={24} />
              </button>
            </div>

           {/* Header */}
<header className="bg-white border-b border-slate-200 sticky top-0 z-40 px-3 md:px-6 h-auto md:h-16 py-3 md:py-0 flex flex-col md:flex-row items-center justify-between shadow-sm gap-2">
  {/* Logo - Siempre visible */}
  <div className="flex items-center justify-between w-full md:w-auto">
    <button
      onClick={goHome}
      className="flex items-center gap-2.5 shrink-0 hover:opacity-80 transition-opacity cursor-pointer text-left"
    >
      <span className="w-10 h-10 rounded-xl bg-slate-950 border border-slate-200 flex items-center justify-center overflow-hidden shadow-sm">
        <img src="/logo.png" alt="TecnoPatch" className="w-full h-full object-contain" />
      </span>
      <span className="flex flex-col leading-none">
        <span className="font-black text-[15px] xs:text-[18px] md:text-[20px] tracking-tighter">TECNOPATCH</span>
        <span className="text-[9px] md:text-[10px] font-black tracking-[0.22em] text-blue-600 uppercase">Cotizador</span>
      </span>
    </button>
    <div className="flex gap-2 md:hidden">
      <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => setShowHistory(true)}>
        <History size={16} />
      </Button>
      <Button variant="ghost" size="sm" className="h-8 w-8 p-0 relative" onClick={() => setShowMobileCart(true)}>
        <ShoppingCart size={16} />
        {quoteItems.length > 0 && <span className="absolute -top-1 -right-1 bg-red-500 text-[8px] text-white w-4 h-4 rounded-full flex items-center justify-center">{quoteItems.length}</span>}
      </Button>
    </div>
  </div>
  
  {/* BARRA DE BUSQUEDA + BOTONES - SOLO EN MOVIL */}
  <div className="w-full md:hidden space-y-2">
    {/* Fila 1: Barra de busqueda */}
    <form onSubmit={handleSearch} className="relative">
      <Input 
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        placeholder="Buscar productos..." 
        className="w-full pl-9 pr-8 py-2 border-slate-200 rounded-lg text-sm bg-slate-50 focus:bg-white focus-visible:ring-blue-600 h-9"
      />
      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
      {searchTerm && (
        <button 
          type="button"
          onClick={() => {setSearchTerm(''); setResults([]); setActiveCategory('');}}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
        >
          <Plus size={12} className="rotate-45" />
        </button>
      )}
    </form>

    {/* Fila 2: Botones MXN/USD e IVA */}
    <div className="flex items-center justify-between gap-2">
      {/* MXN / USD Toggle */}
      <div className="flex bg-slate-100 p-0.5 rounded-lg border border-slate-200 flex-1">
        <button 
          onClick={() => setCurrency('MXN')}
          className={`flex-1 px-3 py-1.5 text-[11px] font-black rounded-md transition-all ${currency === 'MXN' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}
        >
          MXN
        </button>
        <button 
          onClick={() => setCurrency('USD')}
          className={`flex-1 px-3 py-1.5 text-[11px] font-black rounded-md transition-all ${currency === 'USD' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}
        >
          USD
        </button>
      </div>

      {/* SIN IVA / + IVA Toggle */}
      <div className="flex bg-slate-100 p-0.5 rounded-lg border border-slate-200 flex-1">
        <button 
          onClick={() => setIncludeIva(false)}
          className={`flex-1 px-3 py-1.5 text-[11px] font-black rounded-md transition-all ${!includeIva ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}
        >
          SIN IVA
        </button>
        <button 
          onClick={() => setIncludeIva(true)}
          className={`flex-1 px-3 py-1.5 text-[11px] font-black rounded-md transition-all ${includeIva ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}
        >
          + IVA
        </button>
      </div>

      {/* Indicador de conexion compacto */}
      <div className="flex items-center gap-1 shrink-0 bg-emerald-50 px-2 py-1 rounded-lg border border-emerald-200">
        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
        <span className="text-[8px] font-black text-emerald-700">TC: ${exchangeRate.toFixed(2)}</span>
      </div>
    </div>
  </div>

  {/* TODO LO DEMAS - IGUAL QUE EL ORIGINAL (solo desktop) */}
  <div className="hidden md:flex items-center gap-4 w-full md:w-auto overflow-x-auto custom-scrollbar flex-1 justify-end">
    <form onSubmit={handleSearch} className="hidden md:flex flex-1 md:max-w-[300px] lg:max-w-[400px] relative gap-2">
      <div className="flex-1 relative">
        <Input 
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Buscar..." 
          className="w-full pl-3 pr-8 py-2 border-slate-200 rounded-lg text-sm bg-white focus-visible:ring-blue-600 h-9"
        />
        {searchTerm && (
          <button 
            type="button"
            onClick={() => {setSearchTerm(''); setResults([]); setActiveCategory('');}}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
          >
            <Plus size={14} className="rotate-45" />
          </button>
        )}
      </div>
      <Button type="submit" size="sm" className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-3 h-9">
        <Search size={14} />
      </Button>
    </form>

    {/* Currency Toggle */}
    <div className="flex bg-slate-100 p-0.5 rounded-lg shrink-0 border border-slate-200">
      <button 
        onClick={() => setCurrency('MXN')}
        className={`px-3 py-1 text-[10px] font-black rounded-md transition-all ${currency === 'MXN' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
      >
        MXN
      </button>
      <button 
        onClick={() => setCurrency('USD')}
        className={`px-3 py-1 text-[10px] font-black rounded-md transition-all ${currency === 'USD' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
      >
        USD
      </button>
    </div>

    {/* IVA Toggle */}
    <div className="flex bg-slate-100 p-0.5 rounded-lg shrink-0 border border-slate-200">
      <button 
        onClick={() => setIncludeIva(false)}
        className={`px-3 py-1 text-[10px] font-black rounded-md transition-all ${!includeIva ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
      >
        SIN IVA
      </button>
      <button 
        onClick={() => setIncludeIva(true)}
        className={`px-3 py-1 text-[10px] font-black rounded-md transition-all ${includeIva ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
      >
        + IVA
      </button>
    </div>

    <Button variant="outline" size="sm" className="hidden md:flex gap-2 h-9 p-2 px-3 border-slate-200 rounded-lg shrink-0" onClick={() => setShowHistory(true)}>
      <History size={16} /> <span className="hidden xl:inline">Historial</span>
    </Button>

    <Button variant="outline" size="sm" className="hidden md:flex 4xl:hidden gap-2 h-9 p-2 px-3 border-blue-100 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-lg shrink-0 relative" onClick={() => setShowMobileCart(true)}>
      <ShoppingCart size={16} />
      <span className="hidden lg:inline">Cotizacion</span>
      {quoteItems.length > 0 && <span className="absolute -top-1 -right-1 bg-red-500 text-[8px] text-white min-w-4 h-4 px-1 rounded-full flex items-center justify-center">{quoteItems.length}</span>}
    </Button>

    <div className="hidden sm:flex flex-col items-end shrink-0">
      <span className="bg-emerald-50 text-emerald-600 text-[9px] px-2 py-0.5 rounded-full font-semibold border border-emerald-200 whitespace-nowrap">CONECTADO</span>
      <span className="text-[9px] text-slate-500 font-bold mt-0.5">TC: ${exchangeRate.toFixed(2)}</span>
    </div>
  </div>
</header>

            <div className="print:hidden bg-white border-b border-slate-200 px-3 md:px-6 py-2">
              <div className="max-w-[2000px] mx-auto flex items-center gap-2 overflow-x-auto custom-scrollbar">
                {moduleTabs.map(tab => {
                  const Icon = tab.icon;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActiveModule(tab.id)}
                      className={`h-9 px-3 rounded-lg border text-[11px] md:text-xs font-black uppercase tracking-wide flex items-center gap-2 whitespace-nowrap transition-all ${activeModule === tab.id
                        ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                        }`}
                    >
                      <Icon size={15} />
                      {tab.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* History Dialog */}
            <Dialog open={showHistory} onOpenChange={setShowHistory}>
              <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col p-0 overflow-hidden rounded-3xl border-none shadow-2xl">
                <DialogHeader className="p-6 pb-2">
                  <DialogTitle className="text-2xl font-black tracking-tight">Historial de Cotizaciones</DialogTitle>
                  <DialogDescription className="text-slate-500 font-medium">
                    Gestiona y restaura tus cotizaciones previas.
                  </DialogDescription>
                </DialogHeader>
                <div className="flex-1 overflow-y-auto px-6 pb-6 custom-scrollbar">
                  <div className="space-y-3 pt-2">
                    {quoteHistory.length === 0 ? (
                      <div className="py-20 flex flex-col items-center justify-center text-slate-400 bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200">
                        <History size={48} className="mb-4 opacity-20" />
                        <p className="font-bold">No hay cotizaciones registradas.</p>
                      </div>
                    ) : (
                      quoteHistory.map(hist => (
                        <div key={hist.id} className="relative group">
                          <Card
                            className="cursor-pointer hover:border-blue-500 hover:ring-4 hover:ring-blue-50/50 transition-all border-slate-200 shadow-sm"
                            onClick={() => restoreQuote(hist)}
                          >
                            <CardHeader className="py-4 px-5 flex flex-row items-start justify-between bg-white border-b border-slate-50 transition-colors group-hover:bg-blue-50/20">
                              <div className="flex-1 pr-4">
                                <div className="flex items-center gap-2 mb-1">
                                  <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-100 text-[10px] font-black uppercase">
                                    #{hist.id.toUpperCase()}
                                  </Badge>
                                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">{hist.date}</span>
                                  <Badge variant="secondary" className="text-[8px] h-4">{hist.currency}</Badge>
                                </div>
                                <div className="font-black text-slate-900 text-lg">
                                  {hist.total.toLocaleString('es-MX', { style: 'currency', currency: hist.currency || 'MXN' })}
                                </div>
                              </div>
                              <div className="flex flex-col items-end gap-2">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-full transition-colors"
                                  onClick={(e) => deleteFromHistory(e, hist.id)}
                                >
                                  <Trash size={16} />
                                </Button>
                                <span className="text-[9px] font-bold text-slate-400 uppercase">TC: ${hist.exchangeRate}</span>
                              </div>
                            </CardHeader>
                            <CardContent className="py-3 px-5 bg-slate-50/30 group-hover:bg-white transition-colors">
                              <p className="text-xs text-slate-500 font-medium leading-relaxed break-words">
                                {hist.items.map(i => `${i.quantity}x ${i.product.modelo}`).join(', ')}
                              </p>
                            </CardContent>
                          </Card>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </DialogContent>
            </Dialog>

            {activeModule === 'cotizador' ? (
            <main className="flex-1 max-w-[2400px] w-full mx-auto flex flex-col 4xl:flex-row h-[100dvh] md:h-[calc(100dvh-110px)] overflow-hidden">

              {/* Products Sidebar / Left Pane */}
              <section ref={leftSectionRef} className="flex-1 flex flex-col gap-4 overflow-y-auto p-3 sm:p-4 md:p-6 bg-slate-50 relative custom-scrollbar">
                {isInitialState && (
                  <div className="absolute inset-0 pointer-events-none opacity-[0.03]"
                    style={{ backgroundImage: 'radial-gradient(#000 1px, transparent 1px)', backgroundSize: '20px 20px' }}>
                  </div>
                )}
                <div className="sticky top-[-20px] -mx-4 px-4 pt-5 z-30 bg-slate-50 border-b border-slate-200/50 pb-4 shadow-sm">
                  <div className="flex flex-col gap-4">
                    <div className="flex flex-wrap gap-2 justify-center sm:justify-start">
                      {[
                        { name: 'Camaras', query: 'camara cctv' },
                        { name: 'Redes', query: 'enlace ubiquiti' },
                        { name: 'Alarmas', query: 'panel alarma' },
                        { name: 'Acceso', query: 'control de acceso' },
                        { name: 'Cerco', query: 'cerco electrico' }
                      ].map(cat => (
                        <Button
                          key={cat.name}
                          variant={activeCategory === cat.name ? "default" : "outline"}
                          className={`rounded-full text-[10px] md:text-[11px] h-7 px-3 md:px-4 font-bold uppercase transition-all ${activeCategory === cat.name ? 'bg-blue-600 border-blue-600 scale-105 shadow-md shadow-blue-200' : 'hover:bg-blue-50 hover:border-blue-200 text-slate-600'}`}
                          onClick={() => {
                            const newQuery = cat.query;
                            setSearchTerm(newQuery);
                            setActiveCategory(cat.name);
                            fetchProducts(newQuery);
                            leftSectionRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
                          }}
                        >
                          {cat.name}
                        </Button>
                      ))}
                      {activeCategory && (
                        <Badge variant="secondary" className="bg-blue-50 text-blue-700 border-blue-100 flex gap-1 items-center px-2 py-0 h-7">
                          {activeCategory}
                          <button onClick={() => { setActiveCategory(''); fetchProducts('tecnopatch'); }}><Plus size={12} className="rotate-45" /></button>
                        </Badge>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-x-2 gap-y-3 items-center justify-start">
                      <div className="text-[10px] font-bold text-slate-400 whitespace-nowrap min-w-[70px]">
                        {filteredResults.length} {filteredResults.length === 1 ? 'resultado' : 'resultados'}
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[9px] font-black text-slate-400 uppercase tracking-tighter shrink-0">Marca</span>
                        <select
                          className="text-[11px] border border-slate-200 rounded px-1 py-1.5 bg-white outline-none focus:ring-1 ring-blue-500 min-w-[90px] font-medium"
                          value={selectedBrand}
                          onChange={e => setSelectedBrand(e.target.value)}
                        >
                          {brands.map(b => <option key={b} value={b}>{b}</option>)}
                        </select>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[9px] font-black text-slate-400 uppercase tracking-tighter shrink-0">Ordenar</span>
                        <select
                          className="text-[11px] border border-slate-200 rounded px-1 py-1.5 bg-white outline-none focus:ring-1 ring-blue-500 font-medium"
                          value={sortBy}
                          onChange={e => setSortBy(e.target.value as any)}
                        >
                          <option value="default">Relevancia</option>
                          <option value="precio_asc">Precio: Menor a Mayor</option>
                          <option value="precio_desc">Precio: Mayor a Menor</option>
                          <option value="existencia_desc">Stock: Mayor a Menor</option>
                          <option value="nombre_asc">Titulo: A - Z</option>
                          <option value="nombre_desc">Titulo: Z - A</option>
                        </select>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 2xl:grid-cols-3 3xl:grid-cols-4 4xl:grid-cols-5 5xl:grid-cols-6 gap-4 md:gap-6 4xl:gap-8 pt-4">
                  {isInitialState ? (
                    <div className="col-span-full py-8 md:py-16 flex flex-col items-center">
                      {/* Hero Section */}
                      <div className="max-w-2xl w-full text-center mb-12 animate-in fade-in slide-in-from-bottom-4 duration-1000">
                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 border border-blue-100 text-blue-600 text-[10px] font-bold uppercase tracking-widest mb-6">
                          <div className="w-1.5 h-1.5 rounded-full bg-blue-600 animate-pulse"></div>
                          Plataforma de Cotizacion Inteligente
                        </div>
                        <h1 className="text-4xl md:text-5xl font-black text-slate-900 mb-4 tracking-tighter leading-tight">
                          Crea cotizaciones <span className="text-blue-600">profesionales</span> en segundos.
                        </h1>
                        <p className="text-slate-500 text-lg max-w-lg mx-auto leading-relaxed">
                          Accede al catalogo completo de Syscom, gestiona margenes y genera documentos PDF con tu propia marca.
                        </p>
                      </div>

                      {/* Quick Access Grid */}
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 w-full max-w-4xl animate-in fade-in zoom-in-95 delay-300 duration-700 fill-mode-both">
                        {[
                          { icon: Camera, label: 'CCTV & Video', query: 'camara ip hikvision', color: 'bg-blue-600' },
                          { icon: Network, label: 'Networking', query: 'ubiquiti access point', color: 'bg-emerald-600' },
                          { icon: ShieldAlert, label: 'Alarmas', query: 'panel dsc alarma', color: 'bg-red-600' },
                          { icon: Zap, label: 'Energia', query: 'panel solar', color: 'bg-amber-600' },
                        ].map((idx, i) => (
                          <button
                            key={i}
                            onClick={() => { setSearchTerm(idx.query); fetchProducts(idx.query); }}
                            className="group bg-white p-6 rounded-3xl border border-slate-100 shadow-sm hover:shadow-xl hover:border-blue-200 transition-all text-left flex flex-col gap-4 relative overflow-hidden"
                          >
                            <div className={`w-12 h-12 ${idx.color} rounded-2xl flex items-center justify-center text-white shadow-lg transition-transform group-hover:scale-110 group-hover:rotate-3 animate-float`} style={{ animationDelay: `${i * 0.5}s` }}>
                              <idx.icon size={24} strokeWidth={2.4} />
                            </div>
                            <div>
                              <div className="font-black text-slate-900 text-sm">{idx.label}</div>
                              <div className="text-[10px] text-slate-400 font-bold uppercase tracking-tighter">Explorar</div>
                            </div>
                            <div className="absolute -right-4 -bottom-4 w-20 h-20 bg-slate-50 rounded-full opacity-50 group-hover:bg-blue-50 transition-colors"></div>
                          </button>
                        ))}
                      </div>

                      {/* Recent History Prompt (Optional) */}
                      {quoteHistory.length > 0 && (
                        <div className="mt-12 w-full max-w-4xl animate-in fade-in slide-in-from-bottom-2 delay-500 duration-700 fill-mode-both">
                          <div className="flex items-center justify-between mb-4">
                            <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">Retomar Ultimos Proyectos</h3>
                            <Button variant="ghost" size="sm" className="text-[10px] h-6 font-bold" onClick={() => setShowHistory(true)}>Ver Todo</Button>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {quoteHistory.slice(0, 2).map((hist) => (
                              <Card key={hist.id} className="cursor-pointer hover:border-blue-600 transition-all group" onClick={() => restoreQuote(hist)}>
                                <CardContent className="p-4 flex items-center justify-between">
                                  <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center text-blue-600 font-black text-xs group-hover:bg-blue-600 group-hover:text-white transition-colors">
                                      #{hist.id.slice(0, 2).toUpperCase()}
                                    </div>
                                    <div>
                                      <div className="text-sm font-bold text-slate-900 line-clamp-1">{hist.items.map(i => i.product.modelo).join(', ')}</div>
                                      <div className="text-[10px] text-slate-400">{hist.date}</div>
                                    </div>
                                  </div>
                                  <div className="text-right font-black text-slate-900 text-sm">
                                    {hist.total.toLocaleString('es-MX', { style: 'currency', currency: hist.currency || 'MXN' })}
                                  </div>
                                </CardContent>
                              </Card>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Trust Footer */}
                      <div className="mt-16 flex flex-col items-center gap-4 animate-in fade-in duration-1000 delay-700 fill-mode-both">
                        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">Partner Tecnologico</div>
                        <div className="flex items-center gap-8 opacity-40 grayscale hover:grayscale-0 transition-all cursor-default">
                          <div className="font-black text-xl text-slate-900 tracking-tighter">SYSCOM<span className="text-red-600">.</span></div>
                          <div className="font-black text-xl text-slate-900 tracking-tighter">TP<span className="text-blue-600">.</span></div>
                        </div>
                      </div>
                    </div>
                  ) : loading ? (
                    Array.from({ length: 6 }).map((_, i) => (
                      <Card key={i} className="flex flex-col h-[400px]">
                        <Skeleton className="h-full w-full rounded-xl" />
                      </Card>
                    ))
                  ) : filteredResults.length === 0 ? (
                    <div className="col-span-full h-80 flex flex-col items-center justify-center text-slate-400 border-2 border-dashed border-slate-200 rounded-xl bg-white">
                      <Search size={48} className="mb-4 opacity-50 text-slate-300" />
                      <p className="text-lg font-medium">No se encontraron productos para "{searchTerm}"</p>
                      <p className="text-sm">Intenta con otros terminos o filtros.</p>
                    </div>
                  ) : (
                    filteredResults.map(product => {
                      const costUsd = parseFloat(product.precios.precio_descuento) || 0;
                      const listUsd = parseFloat(product.precios.precio_lista) || 0;
                      const specialUsd = parseFloat(product.precios.precio_especial) || 0;

                      return (
                        <Card key={product.producto_id} className="flex flex-col overflow-hidden border-slate-200 shadow-sm hover:shadow-md hover:border-slate-300 rounded-2xl transition-all bg-[#0f172a] relative">
                          <div className="w-full h-[220px] bg-slate-900 border-b border-slate-800 flex items-center justify-center p-4 relative group">
                            {product.img_portada ? (
                              <img
                                src={product.img_portada}
                                alt={product.modelo}
                                className="object-contain w-full h-full transition-transform group-hover:scale-105"
                              />
                            ) : (
                              <ImageIcon className="w-16 h-16 text-slate-700" />
                            )}

                            <div className="absolute top-3 right-3 flex gap-2">
                              <Dialog>
                                <DialogTrigger
                                  render={
                                    <Button variant="secondary" size="icon" className="h-8 w-8 rounded-md bg-slate-800/80 backdrop-blur shadow-sm hover:bg-slate-700 text-slate-300 border border-slate-700" />
                                  }
                                >
                                  <Info size={16} />
                                </DialogTrigger>
                                <DialogContent className="max-w-3xl">
                                  <DialogHeader>
                                    <div className="flex items-center gap-3">
                                      <Badge className="mb-2 bg-slate-100 text-slate-700 border-none hover:bg-slate-200">{product.marca}</Badge>
                                      <span className="text-sm text-slate-500 mb-2">ID: {product.producto_id}</span>
                                    </div>
                                    <DialogTitle className="text-2xl">{product.modelo}</DialogTitle>
                                    <DialogDescription className="text-base text-slate-700 mt-2">
                                      {product.titulo}
                                    </DialogDescription>
                                  </DialogHeader>
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8 py-4">
                                    <div className="bg-white border border-slate-200 rounded-xl p-8 flex items-center justify-center">
                                      {product.img_portada ? (
                                        <img src={product.img_portada} alt={product.modelo} className="w-full object-contain" />
                                      ) : (
                                        <ImageIcon className="text-slate-300 w-32 h-32" />
                                      )}
                                    </div>
                                    <div className="space-y-6">
                                      <div>
                                        <h4 className="text-sm font-semibold text-slate-900 mb-2 uppercase tracking-wider">Detalles de Precio ({currency})</h4>
                                        <div className="grid grid-cols-2 gap-2 text-sm bg-slate-50 p-4 rounded-lg border border-slate-200">
                                          <div className="text-slate-500">Precio de Lista:</div>
                                          <div className="font-semibold text-right text-slate-900">{formatPrice(listUsd)}</div>
                                          <div className="text-slate-500">Precio Especial:</div>
                                          <div className="font-semibold text-right text-slate-900">{formatPrice(specialUsd)}</div>
                                          <div className="text-slate-500">Tu Costo:</div>
                                          <div className="font-semibold text-right text-emerald-600">{formatPrice(costUsd)}</div>
                                        </div>
                                      </div>

                                      <div>
                                        <h4 className="text-sm font-semibold text-slate-900 mb-2 uppercase tracking-wider">Logisticas & Specs</h4>
                                        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                                          <div className="text-slate-500">Stock Availability</div>
                                          <div className="font-medium text-right text-slate-900">{product.total_existencia} units</div>

                                          <div className="text-slate-500">Warranty</div>
                                          <div className="font-medium text-right text-slate-900">{product.garantia || 'N/A'}</div>

                                          <div className="text-slate-500">Dimensions</div>
                                          <div className="font-medium text-right text-slate-900">
                                            {product.ancho || 0} x {product.alto || 0} x {product.largo || 0} cm
                                          </div>

                                          <div className="text-slate-500">Weight</div>
                                          <div className="font-medium text-right text-slate-900">{product.peso || 0} kg</div>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                </DialogContent>
                              </Dialog>
                            </div>
                          </div>

                          <div className="flex-1 flex flex-col p-4 bg-[#141b2d] text-white rounded-b-xl">
                            <div className="text-[12px] font-bold text-emerald-400 tracking-widest mb-1.5 uppercase">{product.marca}</div>
                            <div className="text-[14px] font-medium leading-[1.3] mb-3 text-slate-300 line-clamp-3" title={product.titulo}>{product.titulo}</div>

                            <div className="text-[14px] font-bold text-white mb-4">
                              {product.modelo}
                            </div>

                            <div className="mt-auto">
                              <div className="flex items-center gap-1.5 text-[12px] text-slate-400 font-medium">
                                <span>{formatPrice(listUsd)}</span>
                                <span className="opacity-50">•</span>
                                <span>Precio de Lista</span>
                              </div>
                              {specialUsd < listUsd && (
                                <div className="text-[12px] text-red-400 font-medium mb-1 mt-0.5">
                                  Precio especial: {formatPrice(specialUsd)}
                                </div>
                              )}

                              <div className="flex items-center gap-2 mt-2 mb-4">
                                <div className="font-black text-[24px] leading-none tracking-tight">
                                  {formatPrice(costUsd)}
                                </div>
                                <div className="text-[10px] font-bold text-slate-300 pb-0.5 leading-tight flex flex-col uppercase">
                                  <span>{includeIva ? 'IVA' : 'NETO'}</span>
                                  <span>{includeIva ? 'Incluido' : 'Sin IVA'}</span>
                                </div>
                              </div>

                              <div className="flex items-center gap-2 mb-4">
                                <div className="bg-[#2a4392] text-white text-[12px] font-bold px-2 py-1 rounded flex items-center gap-1">
                                  <Package size={13} /> {product.total_existencia}+
                                </div>
                                <div className="bg-[#1e293b] text-white text-[12px] px-2 py-1 rounded border border-slate-700">
                                  <Check size={13} className="inline mr-1" /> Pz
                                </div>
                              </div>

                              <div className="flex gap-2">
                                <Button
                                  className="flex-1 bg-[#fbbf24] hover:bg-[#f59e0b] text-slate-900 rounded-lg text-sm py-2 h-auto font-bold"
                                  onClick={() => addToQuote(product)}
                                >
                                  <Plus size={16} className="mr-1" /> Agregar
                                </Button>
                              </div>
                            </div>
                          </div>
                        </Card>
                      );
                    })
                  )}
                </div>
              </section>

              {/* Quote Sidebar / Right Pane */}
              <section className={`bg-white flex flex-col shrink-0 border-l border-slate-200 transition-all duration-300 ease-out overflow-hidden shadow-2xl 4xl:shadow-none
            ${showMobileCart
                  ? 'fixed right-0 top-0 bottom-0 z-50 h-[100dvh] w-full sm:w-[420px] xl:w-[460px] opacity-100 flex'
                  : 'hidden 4xl:flex 4xl:static 4xl:w-[420px] 5xl:w-[460px] 4xl:h-full'
                }`}>
                <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between shadow-sm z-20 shrink-0 bg-white">
                  <h3 className="font-bold text-[14px] md:text-[16px] flex items-center gap-2">
                    <ShoppingCart size={18} className="text-blue-600" />
                    Detalle de Cotizacion
                  </h3>
                  <div className="hidden sm:flex flex-wrap items-center gap-1.5 text-[10px] font-bold text-slate-500">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5">{quoteItems.length} partidas</span>
                    <span className="rounded-full bg-blue-50 text-blue-700 px-2 py-0.5">{syscomItemCount} Syscom</span>
                    <span className="rounded-full bg-emerald-50 text-emerald-700 px-2 py-0.5">{manualItemCount} manuales</span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5">{quoteUnitCount} uds</span>
                  </div>
                  <div className="flex gap-2">
                    {!isConfirmingEmpty ? (
                      <button
                        className="text-[10px] text-red-500 hover:bg-red-50 font-black uppercase tracking-tighter px-3 py-1.5 rounded-lg border border-red-100 transition-all active:scale-95"
                        onClick={() => setIsConfirmingEmpty(true)}
                      >
                        Vaciar
                      </button>
                    ) : (
                      <div className="flex items-center gap-1 animate-in fade-in zoom-in-95 duration-200">
                        <button
                          className="bg-red-600 text-white text-[10px] font-black uppercase px-3 py-1.5 rounded-lg shadow-lg shadow-red-200"
                          onClick={() => {
                            setQuoteItems([]);
                            setIsConfirmingEmpty(false);
                            toast.success('Cotizacion vaciada');
                          }}
                        >
                          Seguro?
                        </button>
                        <button
                          className="text-slate-400 p-1.5 hover:text-slate-600 transition-colors"
                          onClick={() => setIsConfirmingEmpty(false)}
                        >
                          <X size={14} />
                        </button>
                      </div>
                    )}
                    <button className="4xl:hidden text-slate-500 hover:text-slate-800" onClick={() => setShowMobileCart(false)}>
                      <X size={20} />
                    </button>
                  </div>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto bg-slate-50/50 custom-scrollbar p-3 sm:p-4 relative" id="cart-scroll-container">
                  <div className="mb-4 p-4 bg-white border border-slate-200 rounded-xl shadow-sm space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <h4 className="text-[11px] font-bold text-slate-800 uppercase tracking-widest flex items-center gap-2">
                        <Plus size={14} className="text-blue-600" /> Partida Manual
                      </h4>
                      <Badge variant="secondary" className="bg-slate-100 text-slate-600 border-slate-200">
                        Material / Servicio
                      </Badge>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {manualTemplates.map(template => (
                        <button
                          key={template.label}
                          type="button"
                          onClick={() => applyManualTemplate(template)}
                          className="h-8 rounded-lg border border-blue-100 bg-blue-50/70 px-2 text-[10px] font-black uppercase tracking-tight text-blue-700 hover:bg-blue-100 transition-colors"
                        >
                          {template.label}
                        </button>
                      ))}
                    </div>

                    <Input
                      placeholder="Ej. Tuberia conduit 3/4, mano de obra, configuracion, obra civil..."
                      className="h-9 text-sm"
                      value={manualTitle}
                      onChange={e => setManualTitle(e.target.value)}
                    />

                    <div className="grid grid-cols-2 gap-2">
                      <select
                        className="h-9 text-sm border-slate-200 rounded-md bg-white border px-3 focus-visible:ring-blue-600 outline-none"
                        value={manualCategory}
                        onChange={e => setManualCategory(e.target.value)}
                      >
                        <option>Material</option>
                        <option>Mano de obra</option>
                        <option>Configuracion</option>
                        <option>Obra civil</option>
                        <option>Servicio</option>
                        <option>Otro</option>
                      </select>
                      <Input
                        placeholder="Unidad"
                        className="h-9 text-sm"
                        value={manualUnit}
                        onChange={e => setManualUnit(e.target.value)}
                      />
                    </div>

                    <div className="grid grid-cols-[88px_1fr] gap-2">
                      <Input
                        type="number"
                        min="1"
                        className="h-9 text-sm"
                        value={manualQuantity}
                        onChange={e => setManualQuantity(Math.max(1, parseFloat(e.target.value) || 1))}
                      />
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-black text-slate-500 uppercase shrink-0">{currency === 'USD' ? 'USD $' : 'MXN $'}</span>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="Precio unitario"
                          className="h-9 text-sm"
                          value={manualUnitPrice}
                          onChange={e => setManualUnitPrice(parseFloat(e.target.value) || 0)}
                        />
                      </div>
                    </div>

                    <Button
                      type="button"
                      className="w-full h-9 bg-slate-900 hover:bg-slate-800 text-white text-[11px] font-black uppercase tracking-widest"
                      onClick={addManualItem}
                    >
                      <Plus size={14} className="mr-2" /> Agregar a Cotizacion
                    </Button>
                  </div>
                  {quoteItems.length === 0 ? (
                    <div className="flex flex-col items-center justify-center text-center text-slate-400 p-6 sm:p-8 border border-dashed border-slate-200 rounded-xl bg-white/60">
                      <ShoppingCart size={40} className="mb-3 opacity-30" />
                      <p className="text-sm font-medium">Cotizacion Vacia</p>
                      <p className="text-[11px] mt-1 opacity-70">Agrega productos del catalogo para comenzar</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {quoteItems.map(item => {
                        const costoBase = (parseFloat(item.product.precios.precio_descuento) || 0) * exchangeRate;
                        const ganancia = item.unitPriceMxn - costoBase;
                        const gananciaPorcentaje = costoBase > 0 ? (ganancia / costoBase) * 100 : 0;

                        return (
                          <div key={item.product.producto_id} className="p-3 bg-white border border-slate-200 rounded-lg shadow-sm group relative">
                            <div className="flex gap-3">
                              <div className="w-12 h-12 bg-slate-50 border rounded-md p-1 shrink-0 flex items-center justify-center">
                                {item.product.img_portada ? (
                                  <img src={item.product.img_portada} className="w-full h-full object-contain" alt="" />
                                ) : item.product.isManual ? (
                                  <FileText className="w-6 h-6 text-blue-500" />
                                ) : <ImageIcon className="w-full h-full text-slate-300" />}
                              </div>
                              <div className="flex-1 pr-6">
                                <div className="text-[12px] font-medium text-slate-900 line-clamp-2 leading-snug">{item.product.titulo}</div>
                                <div className="text-[10px] text-slate-500 mt-1 uppercase font-bold">
                                  {item.product.isManual ? `${item.product.manualCategory || 'Manual'}${item.product.unit ? ` / ${item.product.unit}` : ''}` : item.product.modelo}
                                </div>
                              </div>
                            </div>

                            <div className="mt-3 flex items-center justify-between gap-3 border-t pt-3">
                              <div className="flex items-center border border-slate-200 rounded-lg bg-white overflow-hidden">
                                <button onClick={() => updateQuantity(item.product.producto_id, -1)} className="p-2 px-3 hover:bg-slate-100 text-slate-500 active:bg-slate-200 transition-colors"><Minus size={16} /></button>
                                <span className="text-[14px] font-mono px-3 min-w-[40px] text-center bg-slate-50 py-2 font-bold">{item.quantity}</span>
                                <button onClick={() => updateQuantity(item.product.producto_id, 1)} className="p-2 px-3 hover:bg-slate-100 text-slate-500 active:bg-slate-200 transition-colors"><Plus size={16} /></button>
                              </div>

                              <div className="flex flex-col items-end">
                                <div className="flex items-center">
                                  <span className="text-slate-500 text-[10px] font-black mr-1 uppercase tracking-tighter">{currency === 'USD' ? 'USD $' : 'MXN $'}</span>
                                  <Input
                                    type="number"
                                    className="h-10 w-28 text-right px-3 font-black text-[14px] border-slate-200 focus:border-blue-500"
                                    value={(currency === 'USD' ? item.unitPriceMxn / exchangeRate : item.unitPriceMxn).toFixed(2)}
                                    onChange={(e) => {
                                      const val = parseFloat(e.target.value) || 0;
                                      updateItemPrice(item.product.producto_id, currency === 'USD' ? val * exchangeRate : val);
                                    }}
                                  />
                                </div>
                                <span className="mt-1 text-[10px] font-bold text-slate-500">
                                  Importe: {(currency === 'USD' ? (item.unitPriceMxn * item.quantity) / exchangeRate : item.unitPriceMxn * item.quantity).toLocaleString('es-MX', { style: 'currency', currency })}
                                </span>
                              </div>
                            </div>

                            {/* MATH SECTION - GANANCIA */}
                            {item.product.isManual ? (
                              <div className="mt-3 bg-blue-50 rounded p-2 text-[10px] flex justify-between border border-blue-100 items-center">
                                <span className="text-blue-700 font-bold uppercase tracking-wider">Partida manual</span>
                                <span className="text-blue-500">{item.product.manualCategory}</span>
                              </div>
                            ) : (
                              <div className="mt-3 bg-slate-50 rounded p-2 text-[10px] flex justify-between border border-slate-100 items-center">
                                <div className="text-slate-500">
                                  Costo Base: <span className="font-bold text-slate-700">
                                    {formatPrice(parseFloat(item.product.precios.precio_descuento))}
                                  </span>
                                </div>
                                <div className="text-slate-400">|</div>
                                <div className={ganancia >= 0 ? "text-emerald-600" : "text-red-500"}>
                                  Ganancia: <span className="font-bold">
                                    {currency === 'USD' ? (ganancia / exchangeRate).toLocaleString('en-US', { style: 'currency', currency: 'USD' }) : ganancia.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })}
                                  </span> ({gananciaPorcentaje.toFixed(1)}%)
                                </div>
                              </div>
                            )}

                            <button
                              onClick={() => removeItem(item.product.producto_id)}
                              className="absolute right-2 top-2 p-2 text-slate-300 hover:text-red-500 lg:opacity-0 group-hover:opacity-100 transition-all bg-white/80 hover:bg-red-50 rounded-full border border-transparent hover:border-red-100"
                            >
                              <X size={16} />
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {quoteItems.length > 0 && (
                    <div className="space-y-4">
                      {/* SETTINGS BLOCK */}
                      <div className="mt-6 p-4 bg-blue-50 border border-blue-100 rounded-xl space-y-4 shadow-sm">
                        <h4 className="text-[11px] font-bold text-blue-800 uppercase tracking-widest flex items-center gap-2">
                          <ShoppingCart size={14} /> Estrategia de Venta
                        </h4>

                        <div className="space-y-2">
                          <label className="text-[10px] font-bold text-blue-600 uppercase tracking-wider">Margen de Utilidad Deseado (%)</label>
                          <div className="flex gap-2">
                            <Input
                              type="number"
                              placeholder="30"
                              className="h-9 text-sm bg-white border-blue-200"
                              value={marginPercent}
                              onChange={e => setMarginPercent(parseFloat(e.target.value) || 0)}
                            />
                            <Button
                              variant="secondary"
                              className="h-9 text-[10px] bg-blue-600 hover:bg-blue-700 text-white font-bold uppercase tracking-tighter shrink-0"
                              onClick={() => applyGlobalMargin()}
                            >
                              Aplicar a Todo
                            </Button>
                          </div>
                          <p className="text-[9px] text-blue-400 font-medium">Formula: Costo / (1 - %Margen). Recomendado: 35%+</p>
                        </div>

                        <div className="pt-2 border-t border-blue-200/50 space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-bold text-blue-700">Mostrar Modelos/SKU en PDF</span>
                            <label className="relative inline-flex items-center cursor-pointer scale-75 origin-right">
                              <input type="checkbox" className="sr-only peer" checked={showModelsInPdf} onChange={(e) => setShowModelsInPdf(e.target.checked)} />
                              <div className="w-11 h-6 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                            </label>
                          </div>
                        </div>
                      </div>

                      {/* PROJECT DETAILS BLOCK */}
                      <div className="p-4 bg-white border border-slate-200 rounded-xl space-y-3 shadow-sm">
                        <h4 className="text-[11px] font-bold text-slate-800 uppercase tracking-widest flex items-center gap-2">
                          <FileText size={14} /> Datos del Cliente
                        </h4>
                        <Input
                          placeholder="Nombre del Cliente / Contacto"
                          className="h-9 text-sm"
                          value={clientName}
                          onChange={e => setClientName(e.target.value)}
                        />
                        <Input
                          placeholder="Empresa o Negocio"
                          className="h-9 text-sm"
                          value={clientCompany}
                          onChange={e => setClientCompany(e.target.value)}
                        />
                        <div className="grid grid-cols-2 gap-2">
                          <Input
                            placeholder="WhatApp"
                            className="h-9 text-sm"
                            value={clientPhone}
                            onChange={e => setClientPhone(e.target.value)}
                          />
                          <select
                            className="h-9 text-sm border-slate-200 rounded-md bg-white border px-3 focus-visible:ring-blue-600 outline-none"
                            value={projectType}
                            onChange={e => setProjectType(e.target.value)}
                          >
                            <option>Residencial</option>
                            <option>Empresarial / PyME</option>
                            <option>Corporativo</option>
                            <option>Licitacion</option>
                          </select>
                        </div>

                        <div className="pt-2">
                          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Alcance del Proyecto / Notas PDF</label>
                          <textarea
                            className="w-full text-xs p-3 border border-slate-200 rounded-lg min-h-[100px] focus:ring-1 focus:ring-blue-600 outline-none bg-slate-50"
                            placeholder="Ej: Instalacion de 4 camaras fijas con tuberia conduit de 3/4, configuracion en app movil y respaldo de 15 dias..."
                            value={projectScope}
                            onChange={e => setProjectScope(e.target.value)}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="p-3 lg:p-5 bg-slate-900 text-white mt-auto border-t border-slate-800 shrink-0 shadow-[0_-10px_25px_-5px_rgba(0,0,0,0.3)]">
                  <div className="mb-2 lg:mb-4 pb-2 lg:pb-4 border-b border-white/10 flex items-center justify-between">
                    <span className="text-xs lg:text-sm font-semibold">Incluir IVA (16%)</span>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input type="checkbox" className="sr-only peer" checked={includeIva} onChange={(e) => setIncludeIva(e.target.checked)} />
                      <div className="w-10 h-5 lg:w-11 lg:h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-5 lg:peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 lg:after:h-5 lg:after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                    </label>
                  </div>

                  <div className="hidden lg:flex flex-col gap-3 mb-4 border-b border-white/5 pb-4">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Margen Global</span>
                      <div className="flex gap-1">
                        {[20, 30, 40, 50].map(m => (
                          <button
                            key={m}
                            onClick={() => { setMarginPercent(m); applyGlobalMargin(m); }}
                            className={`text-[9px] font-bold px-2 py-0.5 rounded border transition-all ${marginPercent === m ? 'bg-blue-600 text-white border-blue-600' : 'bg-slate-800 text-slate-400 border-slate-700 hover:border-slate-500'}`}
                          >
                            {m}%
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        value={marginPercent}
                        onChange={(e) => setMarginPercent(parseInt(e.target.value) || 0)}
                        className="h-8 w-16 text-center font-bold text-blue-400 bg-slate-800 border-slate-700"
                      />
                      <Button onClick={() => applyGlobalMargin()} variant="outline" className="flex-1 h-8 text-[11px] font-bold border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white">
                        Actualizar Todos
                      </Button>
                    </div>
                  </div>

                  <div className="hidden lg:block space-y-2 text-[13px] opacity-80 mb-3">
                    <div className="flex justify-between">
                      <span>Subtotal ({currency})</span>
                      <span>{subtotal.toLocaleString('es-MX', { style: 'currency', currency: currency })}</span>
                    </div>
                    {includeIva && (
                      <div className="flex justify-between text-slate-300">
                        <span>IVA (16%)</span>
                        <span>{tax.toLocaleString('es-MX', { style: 'currency', currency: currency })}</span>
                      </div>
                    )}
                    <div className="flex justify-between font-medium">
                      <span>Inversion Syscom {includeIva ? '(c/IVA)' : '(Neto)'}</span>
                      <span className="text-red-400">
                        {calculateTotalCostDisplay().toLocaleString('es-MX', { style: 'currency', currency: currency })}
                      </span>
                    </div>
                    <div className="flex justify-between font-bold">
                      <span>Margen / Ganancia</span>
                      <span className="text-emerald-400">
                        {margin.toLocaleString('es-MX', { style: 'currency', currency: currency })}
                      </span>
                    </div>
                  </div>

                  <div className="flex justify-between items-end text-[18px] lg:text-[20px] font-bold pt-2 lg:pt-3 border-t border-white/10 mt-2 lg:mt-3">
                    <div>
                      <span className="block text-[10px] lg:text-[12px] text-slate-400 uppercase tracking-widest">Total</span>
                      <span>TOTAL {currency}</span>
                    </div>
                    <span className="text-blue-400">{total.toLocaleString('es-MX', { style: 'currency', currency: currency })}</span>
                  </div>

                  <div className="flex gap-2 lg:gap-3 mt-3 lg:mt-6">
                    <Button
                      className="flex-1 p-3 lg:p-4 bg-blue-600 hover:bg-blue-700 text-white h-auto rounded-xl font-black uppercase tracking-widest flex gap-2 items-center justify-center text-[11px] lg:text-[12px] shadow-xl shadow-blue-900/30 active:scale-95 transition-all"
                      disabled={quoteItems.length === 0}
                      onClick={saveQuoteToHistory}
                    >
                      <Save size={18} /> Guardar
                    </Button>
                    <Button
                      className="flex-1 p-3 lg:p-4 bg-white hover:bg-slate-100 text-slate-900 h-auto rounded-xl font-black uppercase tracking-widest flex gap-2 items-center justify-center text-[11px] lg:text-[12px] shadow-lg shadow-black/5 border border-slate-200 active:scale-95 transition-all"
                      disabled={quoteItems.length === 0}
                      onClick={() => {
                        saveQuoteToHistory();
                        setTimeout(() => window.print(), 300);
                      }}
                    >
                      <Printer size={18} /> Imprimir
                    </Button>
                  </div>

                  <div className="flex gap-2 mt-2">
                    <Button
                      className="flex-1 p-2.5 lg:p-3 bg-slate-800 hover:bg-slate-700 text-white h-auto rounded-lg font-bold flex gap-2 items-center justify-center text-[11px] lg:text-xs"
                      disabled={quoteItems.length === 0}
                      onClick={() => setShowPreview(true)}
                    >
                      <FileText size={16} /> Vista Previa
                    </Button>
                    <Button
                      className="flex-1 p-2.5 lg:p-3 bg-emerald-600 hover:bg-emerald-500 text-white h-auto rounded-lg font-bold flex gap-2 items-center justify-center text-[11px] lg:text-xs"
                      disabled={quoteItems.length === 0}
                      onClick={() => {
                        const itemsText = quoteItems.map(item => `• ${item.quantity}x ${item.product.modelo}`).join('%0A');
                        const message = `Hola${clientName ? ` ${clientName}` : ''}, te comparto tu cotizacion de *TecnoPatch*:%0A%0A${itemsText}%0A%0A*Total: $${total.toLocaleString('es-MX', { minimumFractionDigits: 2 })} MXN*%0A%0A_Vigencia: 15 dias._`;
                        const number = clientPhone.replace(/\D/g, '');
                        window.open(`https://wa.me/${number}?text=${message}`, '_blank');
                      }}
                    >
                      Whatsapp
                    </Button>
                    <Button
                      variant="outline"
                      className="p-2.5 lg:p-3 bg-slate-800 h-auto rounded-lg border-slate-700 hover:bg-slate-700 flex items-center justify-center text-white"
                      disabled={quoteItems.length === 0}
                      onClick={() => {
                        const itemsText = quoteItems.map(item => `• ${item.quantity}x ${item.product.modelo} - $${(item.unitPriceMxn * item.quantity).toFixed(2)}`).join('\n');
                        const text = `Cotizacion TecnoPatch\n\n${itemsText}\n\nTotal: $${total.toFixed(2)} MXN\n\nVigencia: 15 dias.`;
                        navigator.clipboard.writeText(text);
                        toast.success('Resumen copiado al portapapeles');
                      }}
                    >
                      <Plus size={16} className="rotate-0" />
                    </Button>
                  </div>
                </div>
              </section>
            </main>
            ) : (
              <main className="flex-1 max-w-[2000px] w-full mx-auto overflow-y-auto bg-slate-50 p-3 md:p-6 custom-scrollbar">
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
                  <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                    <div className="flex items-center gap-2 text-slate-500 text-[10px] font-black uppercase tracking-widest"><Users size={14} /> Clientes activos</div>
                    <div className="mt-2 text-2xl font-black text-slate-900">{activeClients.length}</div>
                  </div>
                  <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                    <div className="flex items-center gap-2 text-slate-500 text-[10px] font-black uppercase tracking-widest"><CalendarDays size={14} /> Citas pendientes</div>
                    <div className="mt-2 text-2xl font-black text-blue-600">{pendingMeetings.length}</div>
                  </div>
                  <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                    <div className="flex items-center gap-2 text-slate-500 text-[10px] font-black uppercase tracking-widest"><Clock3 size={14} /> Hoy</div>
                    <div className="mt-2 text-2xl font-black text-emerald-600">{todayMeetings.length}</div>
                  </div>
                  <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                    <div className="flex items-center gap-2 text-slate-500 text-[10px] font-black uppercase tracking-widest"><FileText size={14} /> Cotizado</div>
                    <div className="mt-2 text-xl font-black text-slate-900">{pipelineTotal.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })}</div>
                  </div>
                </div>

                {activeModule === 'clientes' && (
                  <div className="grid grid-cols-1 xl:grid-cols-[420px_1fr] gap-5">
                    <section className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm h-fit">
                      <h2 className="text-lg font-black text-slate-900 flex items-center gap-2"><UserPlus size={20} className="text-blue-600" /> Nuevo Cliente</h2>
                      <div className="mt-4 space-y-3">
                        <Input placeholder="Nombre del contacto" value={newClient.name} onChange={e => setNewClient({ ...newClient, name: e.target.value })} />
                        <Input placeholder="Empresa / Negocio" value={newClient.company} onChange={e => setNewClient({ ...newClient, company: e.target.value })} />
                        <div className="grid grid-cols-2 gap-2">
                          <Input placeholder="WhatsApp" value={newClient.phone} onChange={e => setNewClient({ ...newClient, phone: e.target.value })} />
                          <Input placeholder="Correo" value={newClient.email} onChange={e => setNewClient({ ...newClient, email: e.target.value })} />
                        </div>
                        <Input placeholder="Direccion del proyecto" value={newClient.address} onChange={e => setNewClient({ ...newClient, address: e.target.value })} />
                        <div className="grid grid-cols-2 gap-2">
                          <select className="h-10 rounded-md border border-slate-200 px-3 text-sm" value={newClient.status} onChange={e => setNewClient({ ...newClient, status: e.target.value as ClientRecord['status'] })}>
                            <option>Prospecto</option>
                            <option>Cotizado</option>
                            <option>Seguimiento</option>
                            <option>Cliente</option>
                            <option>Pausado</option>
                          </select>
                          <Input placeholder="Vendedor" value={newClient.owner} onChange={e => setNewClient({ ...newClient, owner: e.target.value })} />
                        </div>
                        <Input placeholder="Origen: WhatsApp, referido, web..." value={newClient.source} onChange={e => setNewClient({ ...newClient, source: e.target.value })} />
                        <textarea className="w-full min-h-[90px] rounded-lg border border-slate-200 p-3 text-sm outline-none focus:ring-1 focus:ring-blue-600" placeholder="Notas internas" value={newClient.notes} onChange={e => setNewClient({ ...newClient, notes: e.target.value })} />
                        <Button onClick={createClient} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-black"><UserPlus size={16} className="mr-2" /> Guardar Cliente</Button>
                      </div>
                    </section>

                    <section className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                      <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                        <h2 className="text-lg font-black text-slate-900">Cartera de Clientes</h2>
                        <Badge variant="secondary">{clients.length} registros</Badge>
                      </div>
                      <div className="divide-y divide-slate-100">
                        {clients.length === 0 ? (
                          <div className="p-10 text-center text-slate-400 font-bold">Aun no hay clientes registrados.</div>
                        ) : clients.map(client => (
                          <div key={client.id} className="p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3 hover:bg-slate-50">
                            <div>
                              <div className="flex items-center gap-2 flex-wrap">
                                <h3 className="font-black text-slate-900">{client.company || client.name}</h3>
                                <Badge className="bg-blue-50 text-blue-700 border-blue-100">{client.status}</Badge>
                              </div>
                              <p className="text-sm text-slate-500">{client.name}{client.owner && ` · ${client.owner}`}</p>
                              <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-500">
                                {client.phone && <span className="flex items-center gap-1"><Phone size={12} /> {client.phone}</span>}
                                {client.email && <span className="flex items-center gap-1"><Mail size={12} /> {client.email}</span>}
                                {client.address && <span className="flex items-center gap-1"><MapPin size={12} /> {client.address}</span>}
                              </div>
                            </div>
                            <div className="flex gap-2">
                              <Button variant="outline" onClick={() => useClientInQuote(client)}>Usar en cotizacion</Button>
                              <Button variant="secondary" onClick={() => { setNewMeeting({ ...newMeeting, clientId: client.id, location: client.address, owner: client.owner }); setActiveModule('citas'); }}>Agendar</Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>
                  </div>
                )}

                {activeModule === 'citas' && (
                  <div className="grid grid-cols-1 xl:grid-cols-[420px_1fr] gap-5">
                    <section className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm h-fit">
                      <h2 className="text-lg font-black text-slate-900 flex items-center gap-2"><CalendarDays size={20} className="text-blue-600" /> Nueva Cita</h2>
                      <div className="mt-4 space-y-3">
                        <select className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm" value={newMeeting.clientId} onChange={e => setNewMeeting({ ...newMeeting, clientId: e.target.value })}>
                          <option value="">Cliente de cotizacion actual</option>
                          {clients.map(client => <option key={client.id} value={client.id}>{client.company || client.name}</option>)}
                        </select>
                        <Input placeholder="Titulo de la cita" value={newMeeting.title} onChange={e => setNewMeeting({ ...newMeeting, title: e.target.value })} />
                        <div className="grid grid-cols-2 gap-2">
                          <Input type="date" value={newMeeting.date} onChange={e => setNewMeeting({ ...newMeeting, date: e.target.value })} />
                          <Input type="time" value={newMeeting.time} onChange={e => setNewMeeting({ ...newMeeting, time: e.target.value })} />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <select className="h-10 rounded-md border border-slate-200 px-3 text-sm" value={newMeeting.type} onChange={e => setNewMeeting({ ...newMeeting, type: e.target.value as MeetingRecord['type'] })}>
                            <option>Visita tecnica</option>
                            <option>Seguimiento</option>
                            <option>Cierre</option>
                            <option>Instalacion</option>
                            <option>Otro</option>
                          </select>
                          <Input placeholder="Responsable" value={newMeeting.owner} onChange={e => setNewMeeting({ ...newMeeting, owner: e.target.value })} />
                        </div>
                        <Input placeholder="Ubicacion" value={newMeeting.location} onChange={e => setNewMeeting({ ...newMeeting, location: e.target.value })} />
                        <textarea className="w-full min-h-[90px] rounded-lg border border-slate-200 p-3 text-sm outline-none focus:ring-1 focus:ring-blue-600" placeholder="Objetivo / pendientes" value={newMeeting.notes} onChange={e => setNewMeeting({ ...newMeeting, notes: e.target.value })} />
                        <Button onClick={createMeeting} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-black"><CalendarDays size={16} className="mr-2" /> Programar Cita</Button>
                      </div>
                    </section>

                    <section className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                      <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                        <h2 className="text-lg font-black text-slate-900">Agenda Comercial</h2>
                        <Badge variant="secondary">{meetings.length} citas</Badge>
                      </div>
                      <div className="divide-y divide-slate-100">
                        {meetings.length === 0 ? (
                          <div className="p-10 text-center text-slate-400 font-bold">Sin citas programadas.</div>
                        ) : meetings.map(meeting => (
                          <div key={meeting.id} className="p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3 hover:bg-slate-50">
                            <div>
                              <div className="flex items-center gap-2 flex-wrap">
                                <h3 className="font-black text-slate-900">{meeting.title}</h3>
                                <Badge className={meeting.status === 'Realizada' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-blue-50 text-blue-700 border-blue-100'}>{meeting.status}</Badge>
                              </div>
                              <p className="text-sm text-slate-500">{meeting.clientName} · {meeting.type} · {meeting.owner}</p>
                              <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-500">
                                <span className="flex items-center gap-1"><CalendarDays size={12} /> {meeting.date} {meeting.time}</span>
                                {meeting.location && <span className="flex items-center gap-1"><MapPin size={12} /> {meeting.location}</span>}
                              </div>
                              {meeting.notes && <p className="mt-2 text-xs text-slate-500">{meeting.notes}</p>}
                            </div>
                            <div className="flex gap-2">
                              <Button variant="outline" onClick={() => updateMeetingStatus(meeting.id, 'Realizada')}><CheckCircle2 size={15} className="mr-1" /> Realizada</Button>
                              <Button variant="secondary" onClick={() => updateMeetingStatus(meeting.id, 'Reagendada')}>Reagendar</Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>
                  </div>
                )}

                {activeModule === 'seguimiento' && (
                  <div className="grid grid-cols-1 xl:grid-cols-[360px_1fr] gap-5">
                    <section className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm h-fit">
                      <h2 className="text-lg font-black text-slate-900 flex items-center gap-2"><ClipboardList size={20} className="text-blue-600" /> Venta Actual</h2>
                      <div className="mt-4 space-y-3">
                        <select className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm" value={quoteStatus} onChange={e => setQuoteStatus(e.target.value as typeof quoteStatus)}>
                          <option>Borrador</option>
                          <option>Enviada</option>
                          <option>Seguimiento</option>
                          <option>Aceptada</option>
                          <option>Rechazada</option>
                        </select>
                        <Input placeholder="Vendedor responsable" value={salesRep} onChange={e => setSalesRep(e.target.value)} />
                        <div className="grid grid-cols-2 gap-2">
                          <Input type="number" placeholder="Vigencia dias" value={validityDays} onChange={e => setValidityDays(parseInt(e.target.value) || 15)} />
                          <Input type="number" placeholder="Anticipo %" value={advancePercent} onChange={e => setAdvancePercent(parseInt(e.target.value) || 0)} />
                        </div>
                        <Input placeholder="Condiciones de pago" value={paymentTerms} onChange={e => setPaymentTerms(e.target.value)} />
                        <Button onClick={() => setActiveModule('cotizador')} className="w-full bg-slate-900 hover:bg-slate-800 text-white font-black">Volver al Cotizador</Button>
                      </div>
                    </section>

                    <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      {(['Borrador', 'Enviada', 'Seguimiento', 'Aceptada'] as const).map(status => (
                        <div key={status} className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                          <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                            <h3 className="font-black text-slate-900">{status}</h3>
                            <Badge variant="secondary">{quoteHistory.filter(q => (q as any).quoteStatus === status).length}</Badge>
                          </div>
                          <div className="p-4 space-y-3">
                            {quoteHistory.filter(q => ((q as any).quoteStatus || 'Borrador') === status).slice(0, 5).map(q => (
                              <button key={q.id} onClick={() => restoreQuote(q)} className="w-full text-left rounded-lg border border-slate-100 p-3 hover:border-blue-200 hover:bg-blue-50/30 transition-colors">
                                <div className="flex justify-between gap-3">
                                  <span className="font-black text-slate-900">{(q as any).quoteNumber || q.id.toUpperCase()}</span>
                                  <span className="font-black text-blue-600">{q.total.toLocaleString('es-MX', { style: 'currency', currency: q.currency || 'MXN' })}</span>
                                </div>
                                <p className="mt-1 text-xs text-slate-500">{q.clientCompany || q.clientName || 'Sin cliente'} · {q.date}</p>
                              </button>
                            ))}
                            {quoteHistory.filter(q => ((q as any).quoteStatus || 'Borrador') === status).length === 0 && (
                              <p className="text-sm text-slate-400 font-bold">Sin cotizaciones en esta etapa.</p>
                            )}
                          </div>
                        </div>
                      ))}
                    </section>
                  </div>
                )}
              </main>
            )}

            {/* FOOTER */}
            <footer className="print:hidden bg-slate-900 border-t border-slate-800 px-4 md:px-6 py-3 flex flex-col sm:flex-row items-center justify-between gap-1.5 shrink-0">
              <div className="flex items-center gap-3 text-[10px] text-slate-500">
                <span className="font-bold text-slate-400">TecnoPatch</span>
                <span className="opacity-30">·</span>
                <span>Telecomunicaciones · Guadalajara, Jal.</span>
                <span className="opacity-30">·</span>
                <span>33 2849-6052</span>
                <span className="opacity-30 hidden sm:inline">·</span>
                <span className="hidden sm:inline">serviciotecnopatch@gmail.com</span>
              </div>
              <div className="text-[9px] text-slate-700 font-medium tracking-wide">
                Desarrollado por{' '}
                <span className="text-slate-600 font-bold">MMV Digital</span>
              </div>
            </footer>
          </div>

          {/* PRINT ONLY VIEW - Visualizado solo al presionar Ctrl+P */}
          <div className="hidden print:block w-full">
            <QuoteDocument
              quoteItems={quoteItems}
              clientName={clientName}
              clientCompany={clientCompany}
              projectType={projectType}
              subtotal={subtotal}
              tax={tax}
              total={total}
              includeIva={includeIva}
              exchangeRate={exchangeRate}
              projectScope={projectScope}
              showModels={showModelsInPdf}
              currency={currency}
              quoteNumber={quoteNumber}
            />
          </div>

          {/* Preview Dialog */}
          <Dialog open={showPreview} onOpenChange={setShowPreview}>
            <DialogContent className="max-w-5xl w-full sm:w-[95vw] h-[95vh] flex flex-col p-0 overflow-hidden bg-slate-100 rounded-none sm:rounded-xl">
              <DialogHeader className="p-4 border-b bg-white shrink-0 flex flex-row items-center justify-between">
                <DialogTitle>Vista Previa del Documento</DialogTitle>
              </DialogHeader>
              <div className="flex-1 overflow-auto p-2 sm:p-4 md:p-8 bg-slate-400/20 text-left relative flex justify-center">
                {/* Scaling container for mobile responsiveness of A4 fixed layout */}
                <div className="origin-top scale-[0.45] xs:scale-[0.55] sm:scale-75 md:scale-90 lg:scale-100 transition-transform w-[21cm] h-fit bg-white shadow-2xl">
                  <QuoteDocument
                    quoteItems={quoteItems}
                    clientName={clientName}
                    clientCompany={clientCompany}
                    projectType={projectType}
                    subtotal={subtotal}
                    tax={tax}
                    total={total}
                    includeIva={includeIva}
                    exchangeRate={exchangeRate}
                    projectScope={projectScope}
                    showModels={showModelsInPdf}
                    currency={currency}
                    quoteNumber={quoteNumber}
                  />
                </div>
              </div>
              <div className="p-4 bg-white border-t flex flex-col sm:flex-row justify-end gap-3 shrink-0">
                <Button variant="outline" onClick={() => setShowPreview(false)} className="w-full sm:w-auto order-2 sm:order-1">Cerrar</Button>
                <Button onClick={() => { setShowPreview(false); setTimeout(() => window.print(), 100); }} className="w-full sm:w-auto order-1 sm:order-2 bg-blue-600 hover:bg-blue-700">
                  <Printer className="mr-2" size={16} /> Imprimir PDF
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      )}
    </>
  );
}


