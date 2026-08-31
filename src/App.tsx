import React, { useState, useEffect, useRef } from 'react';
import { jsPDF } from 'jspdf';
import { Search, ShoppingCart, Plus, Minus, X, Info, Image as ImageIcon, FileText, History, Printer, Trash, Save, ArrowUp, Users, CalendarDays, ClipboardList, UserPlus, Phone, Mail, MapPin, CheckCircle2, Clock3, Camera, Network, ShieldAlert, Zap, Package, Check, Home, Pencil, Eye, Copy, Download, KeyRound, ShieldCheck } from 'lucide-react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { toast, Toaster } from 'sonner';

import { auth, authReady, firebaseReady } from './firebase';
import { createUserByAdmin, getOrCreateUserProfile, loginWithEmail, logoutUser, saveUserProfile, subscribeToUsers } from './authStore';
import { QuoteDocument } from './components/QuoteDocument';
import { calculateMargin, calculateSubtotal as getQuoteSubtotal, calculateTotalCostDisplay as getTotalCostDisplay, formatSyscomPrice } from './pricing';
import {
  deleteSharedClient,
  deleteSharedInventoryRecord,
  deleteSharedMeeting,
  deleteSharedQuote,
  saveSharedClient,
  saveSharedInventoryLog,
  saveSharedInventoryRecord,
  saveSharedMeeting,
  saveSharedQuote,
  subscribeToClients,
  subscribeToInventory,
  subscribeToInventoryLogs,
  subscribeToMeetings,
  subscribeToQuotes
} from './sharedStore';
import type { Product, QuoteItem, QuoteHistoryItem, ClientRecord, MeetingRecord, UserProfile, ClientInventoryRecord, ClientInventoryLog, ClientInventoryType, ClientInventoryStatus } from './types';

const buildNextQuoteNumber = (history: QuoteHistoryItem[] = []) => {
  const year = new Date().getFullYear();
  const maxNumber = history.reduce((max, quote) => {
    const match = quote.quoteNumber?.match(new RegExp(`^COT-${year}-(\\d+)$`));
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);

  return `COT-${year}-${String(maxNumber + 1).padStart(4, '0')}`;
};

const cleanFileNamePart = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70);

const getLocalDateStamp = () => {
  const date = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const inventoryTypes: Array<{ value: ClientInventoryType; label: string }> = [
  { value: 'dispositivo', label: 'Dispositivo' },
  { value: 'red', label: 'Red' },
  { value: 'correo', label: 'Correo' },
  { value: 'hosting', label: 'Hosting' },
  { value: 'dominio', label: 'Dominio' },
  { value: 'camara', label: 'Camara' },
  { value: 'dvr-nvr', label: 'DVR/NVR' },
  { value: 'router', label: 'Router' },
  { value: 'access-point', label: 'Access point' },
  { value: 'impresora', label: 'Impresora' },
  { value: 'computadora', label: 'Computadora' },
  { value: 'software', label: 'Software' },
  { value: 'plataforma', label: 'Plataforma' },
  { value: 'otro', label: 'Otro' }
];

const inventoryStatuses: Array<{ value: ClientInventoryStatus; label: string }> = [
  { value: 'activo', label: 'Activo' },
  { value: 'reemplazado', label: 'Reemplazado' },
  { value: 'mantenimiento', label: 'Mantenimiento' },
  { value: 'baja', label: 'Baja' },
  { value: 'pendiente', label: 'Pendiente' }
];

const emptyInventoryRecord = () => ({
  type: 'dispositivo' as ClientInventoryType,
  name: '',
  brand: '',
  model: '',
  serialNumber: '',
  macAddress: '',
  ipAddress: '',
  accessUrl: '',
  username: '',
  password: '',
  location: '',
  responsible: '',
  status: 'activo' as ClientInventoryStatus,
  registeredAt: new Date().toLocaleDateString('en-CA'),
  internalNotes: '',
  clientNotes: ''
});

type InventoryDraftRow = ReturnType<typeof emptyInventoryRecord>;

const normalizeInventoryType = (value: string): ClientInventoryType => {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, '-');
  return inventoryTypes.find(type => type.value === normalized || type.label.toLowerCase() === value.trim().toLowerCase())?.value || 'dispositivo';
};

const normalizeInventoryStatus = (value: string): ClientInventoryStatus => {
  const normalized = value.trim().toLowerCase();
  return inventoryStatuses.find(status => status.value === normalized || status.label.toLowerCase() === normalized)?.value || 'activo';
};

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
  const [authLoading, setAuthLoading] = useState(true);
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [currentUserProfile, setCurrentUserProfile] = useState<UserProfile | null>(null);
  const [teamUsers, setTeamUsers] = useState<UserProfile[]>([]);
  const [loginForm, setLoginForm] = useState({ email: '', password: '' });
  const [loginBusy, setLoginBusy] = useState(false);
  const [newTeamUser, setNewTeamUser] = useState({
    name: '',
    email: '',
    password: '',
    role: 'ventas' as UserProfile['role']
  });
  const [creatingTeamUser, setCreatingTeamUser] = useState(false);
  const [isConfirmingEmpty, setIsConfirmingEmpty] = useState(false);
  const [currency, setCurrency] = useState<'MXN' | 'USD'>('MXN');

  // Customer Details & Project Settings
  const [clientName, setClientName] = useState('');
  const [clientCompany, setClientCompany] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [clientRfc, setClientRfc] = useState('');
  const [clientContactRole, setClientContactRole] = useState('');
  const [projectType, setProjectType] = useState('Residencial');
  const [projectScope, setProjectScope] = useState('');
  const [quoteNotes, setQuoteNotes] = useState('');
  const [aiNotesLoading, setAiNotesLoading] = useState(false);
  const [aiEquipLoading, setAiEquipLoading] = useState(false);
  const [aiEquipSuggestions, setAiEquipSuggestions] = useState<Array<{ nombre: string; motivo: string }>>([]);
  const [aiEquipChecked, setAiEquipChecked] = useState(false);
  const [manualTitle, setManualTitle] = useState('');
  const [manualCategory, setManualCategory] = useState('Material');
  const [manualUnit, setManualUnit] = useState('pz');
  const [manualQuantity, setManualQuantity] = useState(1);
  const [manualUnitPrice, setManualUnitPrice] = useState(0);
  const [activeModule, setActiveModule] = useState<'inicio' | 'cotizador' | 'clientes' | 'citas' | 'seguimiento' | 'inventario' | 'usuarios'>('inicio');
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [meetings, setMeetings] = useState<MeetingRecord[]>([]);
  const [inventoryRecords, setInventoryRecords] = useState<ClientInventoryRecord[]>([]);
  const [inventoryLogs, setInventoryLogs] = useState<ClientInventoryLog[]>([]);
  const [selectedInventoryClientId, setSelectedInventoryClientId] = useState('');
  const [editingInventoryId, setEditingInventoryId] = useState('');
  const [inventorySearch, setInventorySearch] = useState('');
  const [inventoryTypeFilter, setInventoryTypeFilter] = useState('Todos');
  const [inventoryStatusFilter, setInventoryStatusFilter] = useState('Todos');
  const [inventoryLocationFilter, setInventoryLocationFilter] = useState('Todas');
  const [includeInventoryPasswords, setIncludeInventoryPasswords] = useState(false);
  const [visiblePasswords, setVisiblePasswords] = useState<Record<string, boolean>>({});
  const [newInventoryRecord, setNewInventoryRecord] = useState(emptyInventoryRecord());
  const [bulkInventoryRows, setBulkInventoryRows] = useState<InventoryDraftRow[]>([emptyInventoryRecord(), emptyInventoryRecord(), emptyInventoryRecord()]);
  const [bulkPasteText, setBulkPasteText] = useState('');
  const [savingBulkInventory, setSavingBulkInventory] = useState(false);
  const [cloudStatus, setCloudStatus] = useState(firebaseReady ? 'Conectando Firebase...' : 'Firebase sin configurar');
  const [quoteStatus, setQuoteStatus] = useState<'Borrador' | 'Enviada' | 'Seguimiento' | 'Aceptada' | 'Rechazada'>('Borrador');
  const [selectedFollowQuoteId, setSelectedFollowQuoteId] = useState('');
  const [salesRep, setSalesRep] = useState('TecnoPatch Ventas');
  const [validityDays, setValidityDays] = useState(15);
  const [advancePercent, setAdvancePercent] = useState(60);
  const [paymentTerms, setPaymentTerms] = useState('60% anticipo, 40% contra entrega');
  const [nextFollowUpDate, setNextFollowUpDate] = useState('');
  const [followUpNote, setFollowUpNote] = useState('');
  const [lostReason, setLostReason] = useState('');
  const [globalCrmSearch, setGlobalCrmSearch] = useState('');
  const [editingClientId, setEditingClientId] = useState('');
  const [editingMeetingId, setEditingMeetingId] = useState('');
  const [newClient, setNewClient] = useState({
    name: '',
    company: '',
    phone: '',
    email: '',
    rfc: '',
    contactRole: '',
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
  const [showModelsInPdf, setShowModelsInPdf] = useState(false);
  const [isInitialState, setIsInitialState] = useState(true);

  // Filter & UI State
  const [sortBy, setSortBy] = useState<'precio_asc' | 'precio_desc' | 'nombre_asc' | 'nombre_desc' | 'existencia_desc' | 'default'>('default');
  const [selectedBrand, setSelectedBrand] = useState('Todas');
  const [brands, setBrands] = useState<string[]>([]);
  const [activeCategory, setActiveCategory] = useState<string>('');
  const leftSectionRef = useRef<HTMLElement>(null);
  const quoteNumberAuto = useRef(true);
  const [quoteNumber, setQuoteNumber] = useState(() => buildNextQuoteNumber());
  const syscomItemCount = quoteItems.filter(item => !item.product.isManual).length;
  const manualItemCount = quoteItems.filter(item => item.product.isManual).length;
  const quoteUnitCount = quoteItems.reduce((acc, item) => acc + item.quantity, 0);
  const pipelineTotal = quoteHistory.reduce((acc, quote) => acc + (quote.total || 0), 0);
  const pendingMeetings = meetings.filter(meeting => meeting.status === 'Programada' || meeting.status === 'Reagendada');
  const activeClients = clients.filter(client => client.status !== 'Pausado');
  const selectedInventoryClient = clients.find(client => client.id === selectedInventoryClientId);
  const todayIso = new Date().toLocaleDateString('en-CA');
  const todayMeetings = meetings.filter(meeting => meeting.date === todayIso);
  const quoteStages = ['Borrador', 'Enviada', 'Seguimiento', 'Aceptada', 'Rechazada'] as const;
  const selectedFollowQuote = quoteHistory.find(quote => quote.id === selectedFollowQuoteId);
  const acceptedTotal = quoteHistory
    .filter(quote => quote.quoteStatus === 'Aceptada')
    .reduce((acc, quote) => acc + (quote.total || 0), 0);
  const openPipelineTotal = quoteHistory
    .filter(quote => !['Aceptada', 'Rechazada'].includes(quote.quoteStatus || 'Borrador'))
    .reduce((acc, quote) => acc + (quote.total || 0), 0);
  const overdueFollowUps = quoteHistory.filter(quote =>
    quote.nextFollowUpDate &&
    quote.nextFollowUpDate < todayIso &&
    !['Aceptada', 'Rechazada'].includes(quote.quoteStatus || 'Borrador')
  );
  const quotesToSend = quoteHistory.filter(quote => (quote.quoteStatus || 'Borrador') === 'Borrador');
  const quotesInFollowUp = quoteHistory.filter(quote => quote.quoteStatus === 'Seguimiento');
  const upcomingFollowUps = quoteHistory
    .filter(quote => quote.nextFollowUpDate && quote.nextFollowUpDate >= todayIso && !['Aceptada', 'Rechazada'].includes(quote.quoteStatus || 'Borrador'))
    .sort((a, b) => String(a.nextFollowUpDate).localeCompare(String(b.nextFollowUpDate)))
    .slice(0, 4);
  const crmSearch = globalCrmSearch.trim().toLowerCase();
  const matchesCrmSearch = (...values: Array<string | number | undefined>) =>
    !crmSearch || values.some(value => String(value || '').toLowerCase().includes(crmSearch));
  const filteredClients = clients.filter(client =>
    matchesCrmSearch(client.name, client.company, client.phone, client.email, client.owner, client.status, client.notes)
  );
  const filteredMeetings = meetings.filter(meeting =>
    matchesCrmSearch(meeting.title, meeting.clientName, meeting.owner, meeting.type, meeting.status, meeting.notes, meeting.location)
  );
  const filteredQuoteHistory = quoteHistory.filter(quote =>
    matchesCrmSearch(
      quote.quoteNumber,
      quote.id,
      quote.clientName,
      quote.clientCompany,
      quote.clientPhone,
      quote.salesRep,
      quote.projectType,
      quote.quoteStatus,
      quote.followUpNote,
      quote.lostReason,
      ...quote.items.map(item => `${item.product.titulo} ${item.product.modelo} ${item.product.marca}`)
    )
  );
  const selectedClientInventory = inventoryRecords.filter(record => record.clientId === selectedInventoryClientId);
  const inventoryLocations = Array.from(new Set(selectedClientInventory.map(record => record.location).filter(Boolean))).sort();
  const filteredInventoryRecords = selectedClientInventory.filter(record => {
    const search = inventorySearch.trim().toLowerCase();
    const matchesSearch = !search || [
      record.name,
      record.brand,
      record.model,
      record.serialNumber,
      record.macAddress,
      record.ipAddress,
      record.accessUrl,
      record.username,
      record.location,
      record.responsible,
      record.internalNotes,
      record.clientNotes
    ].some(value => value?.toLowerCase().includes(search));

    return matchesSearch &&
      (inventoryTypeFilter === 'Todos' || record.type === inventoryTypeFilter) &&
      (inventoryStatusFilter === 'Todos' || record.status === inventoryStatusFilter) &&
      (inventoryLocationFilter === 'Todas' || record.location === inventoryLocationFilter);
  });
  const inventorySummary = {
    total: selectedClientInventory.length,
    active: selectedClientInventory.filter(record => record.status === 'activo').length,
    maintenance: selectedClientInventory.filter(record => record.status === 'mantenimiento').length,
    inactive: selectedClientInventory.filter(record => record.status === 'baja').length
  };
  const syscomSearchBrands = ['Hikvision', 'HiLook', 'Ubiquiti', 'Grandstream', 'TP-Link', 'Dahua', 'DSC', 'Honeywell', 'ZKTeco', 'Ruijie', 'Mikrotik'];
  const normalizedSearchTerm = searchTerm.trim().replace(/\s+/g, ' ');
  const detectedSearchBrand = syscomSearchBrands.find(brand => normalizedSearchTerm.toLowerCase().includes(brand.toLowerCase()));
  const searchKeywords = normalizedSearchTerm
    .replace(/[()/|,;]/g, ' ')
    .split(' ')
    .filter(word => /poe|inyector|injector|30w|60w|gigabit|multigigabit|2\.5gbps|switch|camara|nvr|dvr|panel|sensor|telefono|access|point/i.test(word))
    .slice(0, 4);
  const searchSuggestions = Array.from(new Set([
    detectedSearchBrand || '',
    detectedSearchBrand && searchKeywords.length ? `${detectedSearchBrand} ${searchKeywords.slice(0, 3).join(' ')}` : '',
    searchKeywords.length ? searchKeywords.join(' ') : '',
    normalizedSearchTerm.length > 80 ? normalizedSearchTerm.split(' ').slice(0, 6).join(' ') : ''
  ].filter(Boolean)));
  const shouldShowSearchTip = activeModule === 'cotizador' && normalizedSearchTerm.length > 45;
  const isAdmin = currentUserProfile?.role === 'admin';
  const canManageInventory = currentUserProfile?.role === 'admin' || currentUserProfile?.role === 'ventas';
  const canAccessInventorySecrets = isAdmin;
  const moduleTabs = [
    { id: 'inicio', label: 'Inicio', icon: Home },
    { id: 'cotizador', label: 'Cotizador', icon: ShoppingCart },
    { id: 'clientes', label: 'Clientes', icon: Users },
    { id: 'citas', label: 'Citas', icon: CalendarDays },
    { id: 'seguimiento', label: 'Seguimiento', icon: ClipboardList },
    { id: 'inventario', label: 'Inventario', icon: KeyRound },
    ...(isAdmin ? [{ id: 'usuarios' as const, label: 'Usuarios', icon: UserPlus }] : [])
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
    if (!authReady || !auth) {
      setAuthLoading(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, async user => {
      setAuthUser(user);
      if (!user) {
        setCurrentUserProfile(null);
        setAuthLoading(false);
        return;
      }

      try {
        const profile = await getOrCreateUserProfile(user);
        setCurrentUserProfile(profile);
        if (!profile) {
          toast.error('Tu usuario no esta activo. Pide acceso al administrador.');
          await logoutUser();
        }
      } catch (error) {
        console.error('Auth profile error:', error);
        toast.error('No se pudo cargar el perfil de usuario.');
        setCurrentUserProfile(null);
      } finally {
        setAuthLoading(false);
      }
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!isAdmin || !authUser) return;

    return subscribeToUsers(
      users => setTeamUsers(users),
      error => {
        console.error('Users sync error:', error);
        toast.error('No se pudo sincronizar usuarios.');
      }
    );
  }, [isAdmin, authUser]);

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

    const cloudSubscriptions: Array<() => void> = [];

    if (firebaseReady && currentUserProfile) {
      const statusTimer = window.setTimeout(() => {
        setCloudStatus(current => current === 'Conectando Firebase...' ? 'Firebase sincronizando...' : current);
      }, 3500);
      cloudSubscriptions.push(() => window.clearTimeout(statusTimer));

      const handleCloudError = (error: Error) => {
        console.error('Firebase sync error:', error);
        setCloudStatus('Firebase requiere permisos/configuracion');
        toast.error('No se pudo sincronizar con Firebase. Revisa Firestore y variables VITE_FIREBASE_*.');
      };

      cloudSubscriptions.push(
        subscribeToQuotes(data => {
          window.clearTimeout(statusTimer);
          setQuoteHistory(data);
          setCloudStatus('Firebase conectado');
        }, handleCloudError),
        subscribeToClients(data => {
          window.clearTimeout(statusTimer);
          setClients(data);
          setCloudStatus('Firebase conectado');
        }, handleCloudError),
        subscribeToMeetings(data => {
          window.clearTimeout(statusTimer);
          setMeetings(data);
          setCloudStatus('Firebase conectado');
        }, handleCloudError),
        subscribeToInventory(data => {
          window.clearTimeout(statusTimer);
          setInventoryRecords(data);
          setCloudStatus('Firebase conectado');
        }, handleCloudError)
      );
    } else {
      setCloudStatus('Firebase sin configurar');
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
      cloudSubscriptions.forEach(unsubscribe => unsubscribe());
    };
  }, [currentUserProfile]);

  useEffect(() => {
    if (!firebaseReady || !currentUserProfile || !selectedInventoryClientId) {
      setInventoryLogs([]);
      return;
    }

    return subscribeToInventoryLogs(
      selectedInventoryClientId,
      logs => setInventoryLogs(logs),
      error => {
        console.error('Inventory logs sync error:', error);
        toast.error('No se pudo sincronizar la bitacora de inventario.');
      }
    );
  }, [currentUserProfile, selectedInventoryClientId]);

  useEffect(() => {
    if (!quoteNumberAuto.current || quoteItems.length > 0) return;
    setQuoteNumber(buildNextQuoteNumber(quoteHistory));
  }, [quoteHistory, quoteItems.length]);

  useEffect(() => {
    if (!selectedInventoryClientId && clients.length > 0) {
      setSelectedInventoryClientId(clients[0].id);
    }
  }, [clients, selectedInventoryClientId]);

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

  useEffect(() => {
    const dismissToasts = () => toast.dismiss();
    document.addEventListener('pointerdown', dismissToasts);
    return () => document.removeEventListener('pointerdown', dismissToasts);
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
  const cloudIsConnected = cloudStatus === 'Firebase conectado' || cloudStatus === 'Firebase guardado';
  const cloudIsWriting = cloudStatus === 'Guardando Firebase...';
  const cloudBadgeClass = cloudIsConnected
    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : cloudIsWriting
      ? 'bg-blue-50 text-blue-700 border-blue-200'
      : 'bg-amber-50 text-amber-700 border-amber-200';
  const cloudDotClass = cloudIsConnected ? 'bg-emerald-500' : cloudIsWriting ? 'bg-blue-500' : 'bg-amber-500';
  const compactCloudStatus = cloudStatus
    .replace('Firebase ', 'FB ')
    .replace('Conectando ', 'Conectando ')
    .replace('requiere permisos/configuracion', 'sin permisos');
  const formatCloudError = (error: unknown) => error instanceof Error ? error.message : 'Error desconocido de Firebase';

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginForm.email.trim() || !loginForm.password) {
      toast.error('Agrega correo y contraseña');
      return;
    }

    try {
      setLoginBusy(true);
      await loginWithEmail(loginForm.email.trim(), loginForm.password);
      setLoginForm({ email: '', password: '' });
    } catch (error) {
      console.error('Login error:', error);
      toast.error('No se pudo iniciar sesion. Revisa correo o contraseña.');
    } finally {
      setLoginBusy(false);
    }
  };

  const createTeamUser = async () => {
    if (!isAdmin || !currentUserProfile) return;
    if (!newTeamUser.email.trim() || newTeamUser.password.length < 6) {
      toast.error('Agrega correo y contraseña de al menos 6 caracteres');
      return;
    }

    try {
      setCreatingTeamUser(true);
      await createUserByAdmin({
        email: newTeamUser.email.trim(),
        password: newTeamUser.password,
        name: newTeamUser.name.trim(),
        role: newTeamUser.role,
        createdBy: currentUserProfile.email
      });
      setNewTeamUser({ name: '', email: '', password: '', role: 'ventas' });
      toast.success('Usuario creado');
    } catch (error) {
      console.error('Create user error:', error);
      toast.error(error instanceof Error ? error.message : 'No se pudo crear el usuario');
    } finally {
      setCreatingTeamUser(false);
    }
  };

  const toggleUserActive = async (profile: UserProfile) => {
    if (!isAdmin) return;
    await saveUserProfile({ ...profile, active: !profile.active });
    toast.success(profile.active ? 'Usuario desactivado' : 'Usuario activado');
  };

  const changeUserRole = async (profile: UserProfile, role: UserProfile['role']) => {
    if (!isAdmin) return;
    await saveUserProfile({ ...profile, role });
    toast.success('Rol actualizado');
  };

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

  const resetClientForm = () => {
    setEditingClientId('');
    setNewClient({
      name: '',
      company: '',
      phone: '',
      email: '',
      rfc: '',
      contactRole: '',
      address: '',
      source: 'WhatsApp',
      status: 'Prospecto',
      owner: 'Ventas',
      notes: ''
    });
  };

  const resetMeetingForm = () => {
    setEditingMeetingId('');
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
  };

  const createClient = async () => {
    if (!newClient.name.trim() && !newClient.company.trim()) {
      toast.error('Agrega nombre o empresa del cliente');
      return;
    }

    const existingClient = clients.find(client => client.id === editingClientId);
    const client: ClientRecord = {
      id: editingClientId || `client-${Date.now()}`,
      name: newClient.name.trim(),
      company: newClient.company.trim(),
      phone: newClient.phone.trim(),
      email: newClient.email.trim(),
      rfc: newClient.rfc.trim(),
      contactRole: newClient.contactRole.trim(),
      address: newClient.address.trim(),
      source: newClient.source,
      status: newClient.status,
      owner: newClient.owner.trim() || 'Ventas',
      notes: newClient.notes.trim(),
      createdAt: existingClient?.createdAt || new Date().toISOString()
    };

    try {
      setCloudStatus('Guardando Firebase...');
      await saveSharedClient(client);
      setCloudStatus('Firebase guardado');
      setClientName(client.name || client.company);
      setClientCompany(client.company);
      setClientPhone(client.phone);
      setClientEmail(client.email);
      setClientRfc(client.rfc || '');
      setClientContactRole(client.contactRole || '');
      resetClientForm();
      toast.success(editingClientId ? 'Cliente actualizado' : 'Cliente agregado al CRM compartido');
    } catch (error) {
      console.error('Error saving client:', error);
      setCloudStatus('Firebase no guardo');
      toast.error(`No se pudo guardar el cliente: ${formatCloudError(error)}`);
    }
  };

  const useClientInQuote = (client: ClientRecord) => {
    setClientName(client.name || client.company);
    setClientCompany(client.company);
    setClientPhone(client.phone);
    setClientEmail(client.email);
    setClientRfc(client.rfc || '');
    setClientContactRole(client.contactRole || '');
    setProjectScope(current => {
      const addressLine = client.address ? `Direccion del proyecto: ${client.address}` : '';
      const addressLineRegex = /^Direccion del proyecto:.*$/m;
      if (!current) return addressLine;
      if (addressLineRegex.test(current)) {
        return addressLine ? current.replace(addressLineRegex, addressLine) : current.replace(addressLineRegex, '').trim();
      }
      return addressLine ? `${addressLine}\n${current}` : current;
    });
    setActiveModule('cotizador');
    toast.success('Cliente cargado en cotizacion');
  };

  const suggestTechnicalNotes = async () => {
    if (quoteItems.length === 0) {
      toast.error('Agrega al menos un producto a la cotizacion primero');
      return;
    }
    setAiNotesLoading(true);
    try {
      const response = await fetch('/api/ai-suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'technical-notes',
          items: quoteItems.map(item => ({
            nombre: item.product.titulo,
            marca: item.product.marca,
            cantidad: item.quantity
          })),
          clientNotes: quoteNotes
        })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'No se pudo generar la sugerencia');
      }
      setQuoteNotes(current => current ? `${current}\n${data.suggestion}` : data.suggestion);
      toast.success('Notas tecnicas sugeridas con IA');
    } catch (error: any) {
      console.error('suggestTechnicalNotes error:', error);
      toast.error(error.message || 'Error al consultar la IA');
    } finally {
      setAiNotesLoading(false);
    }
  };

  const suggestComplementaryEquipment = async () => {
    if (quoteItems.length === 0) {
      toast.error('Agrega al menos un producto a la cotizacion primero');
      return;
    }
    setAiEquipLoading(true);
    setAiEquipChecked(false);
    try {
      const response = await fetch('/api/ai-suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'complementary-equipment',
          items: quoteItems.map(item => ({
            nombre: item.product.titulo,
            marca: item.product.marca,
            cantidad: item.quantity
          }))
        })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'No se pudo generar la sugerencia');
      }
      setAiEquipSuggestions(data.suggestions || []);
      setAiEquipChecked(true);
      if (!data.suggestions || data.suggestions.length === 0) {
        toast.success('La IA no encontro equipo adicional que sugerir, parece que ya esta completo');
      }
    } catch (error: any) {
      console.error('suggestComplementaryEquipment error:', error);
      toast.error(error.message || 'Error al consultar la IA');
    } finally {
      setAiEquipLoading(false);
    }
  };

  const searchSuggestion = (nombre: string) => {
    setSearchTerm(nombre);
    fetchProducts(nombre);
  };

  const editClient = (client: ClientRecord) => {
    setEditingClientId(client.id);
    setNewClient({
      name: client.name || '',
      company: client.company || '',
      phone: client.phone || '',
      email: client.email || '',
      rfc: client.rfc || '',
      contactRole: client.contactRole || '',
      address: client.address || '',
      source: client.source || 'WhatsApp',
      status: client.status || 'Prospecto',
      owner: client.owner || 'Ventas',
      notes: client.notes || ''
    });
    setActiveModule('clientes');
    toast.info('Cliente cargado para editar');
  };

  const createMeeting = async () => {
    const selectedClient = clients.find(client => client.id === newMeeting.clientId);
    const existingMeeting = meetings.find(meeting => meeting.id === editingMeetingId);
    const fallbackClientName = clientName || clientCompany;
    if (!selectedClient && !fallbackClientName && !existingMeeting?.clientName) {
      toast.error('Selecciona un cliente o carga uno en la cotizacion');
      return;
    }
    if (!newMeeting.date || !newMeeting.time) {
      toast.error('Agrega fecha y hora de la cita');
      return;
    }

    const meeting: MeetingRecord = {
      id: editingMeetingId || `meeting-${Date.now()}`,
      clientId: selectedClient?.id || existingMeeting?.clientId || '',
      clientName: selectedClient ? (selectedClient.company || selectedClient.name) : (existingMeeting?.clientName || fallbackClientName),
      title: newMeeting.title.trim() || newMeeting.type,
      date: newMeeting.date,
      time: newMeeting.time,
      type: newMeeting.type,
      owner: newMeeting.owner.trim() || salesRep,
      location: newMeeting.location.trim() || selectedClient?.address || '',
      status: newMeeting.status,
      notes: newMeeting.notes.trim()
    };

    try {
      setCloudStatus('Guardando Firebase...');
      await saveSharedMeeting(meeting);
      setCloudStatus('Firebase guardado');
      resetMeetingForm();
      toast.success(editingMeetingId ? 'Cita actualizada' : 'Cita programada en agenda compartida');
    } catch (error) {
      console.error('Error saving meeting:', error);
      setCloudStatus('Firebase no guardo');
      toast.error(`No se pudo guardar la cita: ${formatCloudError(error)}`);
    }
  };

  const editMeeting = (meeting: MeetingRecord) => {
    setEditingMeetingId(meeting.id);
    setNewMeeting({
      clientId: meeting.clientId || '',
      title: meeting.title || '',
      date: meeting.date || '',
      time: meeting.time || '',
      type: meeting.type || 'Visita tecnica',
      owner: meeting.owner || 'Ventas',
      location: meeting.location || '',
      status: meeting.status || 'Programada',
      notes: meeting.notes || ''
    });
    setActiveModule('citas');
    toast.info('Cita cargada para editar');
  };

  const updateMeetingStatus = async (id: string, status: MeetingRecord['status']) => {
    const meeting = meetings.find(item => item.id === id);
    if (!meeting) return;

    try {
      setCloudStatus('Guardando Firebase...');
      await saveSharedMeeting({ ...meeting, status });
      setCloudStatus('Firebase guardado');
      toast.success('Cita actualizada');
    } catch (error) {
      console.error('Error updating meeting:', error);
      setCloudStatus('Firebase no guardo');
      toast.error(`No se pudo actualizar la cita: ${formatCloudError(error)}`);
    }
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
          const newQuantity = Math.max(0.01, item.quantity + delta);
          return { ...item, quantity: newQuantity };
        }
        return item;
      })
    );
  };

  const updateItemQuantity = (id: string, quantity: number) => {
    setQuoteItems(current =>
      current.map(item => {
        if (item.product.producto_id === id) {
          return { ...item, quantity: Number.isFinite(quantity) ? Math.max(0.01, quantity) : item.quantity };
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

  const updateItemCost = (id: string, newCostMxn: number) => {
    const safeCostUsd = (Number.isFinite(newCostMxn) ? Math.max(0, newCostMxn) : 0) / exchangeRate;
    setQuoteItems(current =>
      current.map(item => {
        if (item.product.producto_id === id) {
          return {
            ...item,
            product: {
              ...item.product,
              precios: {
                ...item.product.precios,
                precio_descuento: safeCostUsd.toString()
              }
            }
          };
        }
        return item;
      })
    );
  };

  const updateItemProductField = (id: string, updates: Partial<Pick<Product, 'titulo' | 'manualCategory' | 'unit'>>) => {
    setQuoteItems(current =>
      current.map(item =>
        item.product.producto_id === id
          ? { ...item, product: { ...item.product, ...updates } }
          : item
      )
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

  const getPdfFileName = () => {
    const clientLabel = cleanFileNamePart(clientCompany || clientName || 'sin-cliente') || 'sin-cliente';
    const folioLabel = cleanFileNamePart(quoteNumber || buildNextQuoteNumber(quoteHistory)) || '2026-0001';
    const consecutiveLabel = folioLabel.replace(/^COT-?/i, '') || folioLabel;
    return `COT-${clientLabel}-${consecutiveLabel}`;
  };

  const printQuotePdf = (delay = 0) => {
    const previousTitle = document.title;
    const pdfFileName = getPdfFileName();
    document.title = pdfFileName;

    const restoreTitle = () => {
      document.title = previousTitle;
      window.removeEventListener('afterprint', restoreTitle);
    };

    window.addEventListener('afterprint', restoreTitle);
    window.setTimeout(() => {
      window.print();
    }, delay);
  };

  const saveQuoteToHistory = async ({ printAfter = true }: { printAfter?: boolean } = {}) => {
    if (quoteItems.length === 0) return;
    const newQuote: QuoteHistoryItem = {
      id: Math.random().toString(36).substring(2, 9),
      quoteNumber: quoteNumber.trim() || buildNextQuoteNumber(quoteHistory),
      date: new Date().toLocaleString(),
      items: [...quoteItems],
      subtotal,
      tax,
      total,
      includeTax: includeIva,
      currency,
      exchangeRate,
      clientName,
      clientCompany,
      clientPhone,
      clientEmail,
      clientRfc,
      clientContactRole,
      projectType,
      projectScope,
      quoteNotes,
      marginPercent,
      showModelsInPdf,
      quoteStatus,
      salesRep,
      validityDays,
      advancePercent,
      paymentTerms,
      nextFollowUpDate,
      followUpNote,
      lostReason,
      savedAt: Date.now()
    };

    try {
      setCloudStatus('Guardando Firebase...');
      await saveSharedQuote(newQuote);
      setCloudStatus('Firebase guardado');
      toast.success('Cotizacion guardada en historial compartido');
      if (printAfter) printQuotePdf(500);
    } catch (error) {
      console.error('Error saving quote:', error);
      setCloudStatus('Firebase no guardo');
      toast.error(`No se pudo guardar la cotizacion: ${formatCloudError(error)}`);
    }
  };

  const deleteFromHistory = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();

    if (!window.confirm('Eliminar esta cotizacion del historial compartido?')) return;

    try {
      setCloudStatus('Guardando Firebase...');
      await deleteSharedQuote(id);
      setCloudStatus('Firebase guardado');
      toast.success('Cotizacion eliminada del historial compartido');
    } catch (error) {
      console.error('Error deleting quote:', error);
      setCloudStatus('Firebase no guardo');
      toast.error(`No se pudo eliminar la cotizacion: ${formatCloudError(error)}`);
    }
  };

  const deleteClient = async (client: ClientRecord) => {
    const label = client.company || client.name || 'este cliente';
    if (!window.confirm(`Eliminar ${label} de la cartera compartida? Las cotizaciones ya guardadas no se eliminan.`)) return;

    try {
      setCloudStatus('Guardando Firebase...');
      await deleteSharedClient(client.id);
      setCloudStatus('Firebase guardado');
      toast.success('Cliente eliminado');
    } catch (error) {
      console.error('Error deleting client:', error);
      setCloudStatus('Firebase no guardo');
      toast.error(`No se pudo eliminar el cliente: ${formatCloudError(error)}`);
    }
  };

  const deleteMeeting = async (meeting: MeetingRecord) => {
    if (!window.confirm(`Eliminar la cita "${meeting.title}"?`)) return;

    try {
      setCloudStatus('Guardando Firebase...');
      await deleteSharedMeeting(meeting.id);
      setCloudStatus('Firebase guardado');
      toast.success('Cita eliminada');
    } catch (error) {
      console.error('Error deleting meeting:', error);
      setCloudStatus('Firebase no guardo');
      toast.error(`No se pudo eliminar la cita: ${formatCloudError(error)}`);
    }
  };

  const logInventoryAction = async (record: Pick<ClientInventoryRecord, 'id' | 'clientId' | 'clientName' | 'name'>, action: string) => {
    if (!currentUserProfile) return;

    try {
      await saveSharedInventoryLog({
        id: `invlog-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        clientId: record.clientId,
        clientName: record.clientName,
        recordId: record.id,
        recordName: record.name || 'Registro tecnico',
        action,
        userId: currentUserProfile.uid,
        userName: currentUserProfile.name,
        userEmail: currentUserProfile.email,
        createdAt: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error saving inventory log:', error);
    }
  };

  const resetInventoryForm = () => {
    setEditingInventoryId('');
    setNewInventoryRecord(emptyInventoryRecord());
  };

  const saveInventoryRecord = async () => {
    if (!selectedInventoryClient) {
      toast.error('Selecciona un cliente para guardar el registro.');
      return;
    }
    if (!newInventoryRecord.name.trim()) {
      toast.error('Agrega el nombre del dispositivo o servicio.');
      return;
    }
    if (!canManageInventory) {
      toast.error('Tu usuario no tiene permiso para modificar inventario.');
      return;
    }

    const existingRecord = inventoryRecords.find(record => record.id === editingInventoryId);
    const now = new Date().toISOString();
    const record: ClientInventoryRecord = {
      id: editingInventoryId || `inv-${Date.now()}`,
      clientId: selectedInventoryClient.id,
      clientName: selectedInventoryClient.company || selectedInventoryClient.name,
      ...newInventoryRecord,
      password: canAccessInventorySecrets ? newInventoryRecord.password : (existingRecord?.password || ''),
      updatedAt: now,
      createdBy: existingRecord?.createdBy || currentUserProfile?.name,
      updatedBy: currentUserProfile?.name
    };

    try {
      setCloudStatus('Guardando Firebase...');
      await saveSharedInventoryRecord(record);
      await logInventoryAction(record, editingInventoryId ? 'Registro editado' : 'Registro creado');
      setCloudStatus('Firebase guardado');
      toast.success(editingInventoryId ? 'Registro actualizado' : 'Registro agregado');
      resetInventoryForm();
    } catch (error) {
      console.error('Error saving inventory record:', error);
      setCloudStatus('Firebase no guardo');
      toast.error(`No se pudo guardar el registro: ${formatCloudError(error)}`);
    }
  };

  const editInventoryRecord = (record: ClientInventoryRecord) => {
    setEditingInventoryId(record.id);
    setSelectedInventoryClientId(record.clientId);
    setNewInventoryRecord({
      type: record.type,
      name: record.name || '',
      brand: record.brand || '',
      model: record.model || '',
      serialNumber: record.serialNumber || '',
      macAddress: record.macAddress || '',
      ipAddress: record.ipAddress || '',
      accessUrl: record.accessUrl || '',
      username: record.username || '',
      password: canAccessInventorySecrets ? (record.password || '') : '',
      location: record.location || '',
      responsible: record.responsible || '',
      status: record.status || 'activo',
      registeredAt: record.registeredAt || new Date().toLocaleDateString('en-CA'),
      internalNotes: record.internalNotes || '',
      clientNotes: record.clientNotes || ''
    });
  };

  const deleteInventoryRecord = async (record: ClientInventoryRecord) => {
    if (!canManageInventory) return;
    if (!window.confirm(`Eliminar el registro "${record.name}"?`)) return;

    try {
      setCloudStatus('Guardando Firebase...');
      await deleteSharedInventoryRecord(record.id);
      await logInventoryAction(record, 'Registro eliminado');
      setCloudStatus('Firebase guardado');
      toast.success('Registro eliminado');
    } catch (error) {
      console.error('Error deleting inventory record:', error);
      setCloudStatus('Firebase no guardo');
      toast.error(`No se pudo eliminar el registro: ${formatCloudError(error)}`);
    }
  };

  const revealInventoryPassword = async (record: ClientInventoryRecord) => {
    if (!canAccessInventorySecrets) {
      toast.error('Solo admin puede ver contrasenas.');
      return;
    }
    setVisiblePasswords(current => ({ ...current, [record.id]: !current[record.id] }));
    if (!visiblePasswords[record.id]) await logInventoryAction(record, 'Contraseña consultada');
  };

  const copyInventoryValue = async (record: ClientInventoryRecord, value: string, action: string, label: string) => {
    if (!value) {
      toast.error(`No hay ${label} para copiar.`);
      return;
    }
    if (action.includes('Contraseña') && !canAccessInventorySecrets) {
      toast.error('Solo admin puede copiar contrasenas.');
      return;
    }

    await navigator.clipboard.writeText(value);
    await logInventoryAction(record, action);
    toast.success(`${label} copiado`);
  };

  const downloadInventoryCsv = async () => {
    if (!selectedInventoryClient) return;

    const rows = filteredInventoryRecords.map(record => ({
      Cliente: selectedInventoryClient.company || selectedInventoryClient.name,
      Tipo: inventoryTypes.find(type => type.value === record.type)?.label || record.type,
      Nombre: record.name,
      Marca: record.brand,
      Modelo: record.model,
      Serie: record.serialNumber,
      IP: record.ipAddress,
      MAC: record.macAddress,
      Acceso: record.accessUrl,
      Usuario: record.username,
      Contrasena: includeInventoryPasswords && canAccessInventorySecrets ? record.password : '',
      Ubicacion: record.location,
      Responsable: record.responsible,
      Estado: record.status,
      NotasCliente: record.clientNotes
    }));

    const headers = Object.keys(rows[0] || { Cliente: '', Tipo: '', Nombre: '' });
    const csv = [
      headers.join(','),
      ...rows.map(row => headers.map(header => `"${String((row as any)[header] || '').replace(/"/g, '""')}"`).join(','))
    ].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `inventario-${cleanFileNamePart(selectedInventoryClient.company || selectedInventoryClient.name)}-${getLocalDateStamp()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    await logInventoryAction({
      id: 'reporte',
      clientId: selectedInventoryClient.id,
      clientName: selectedInventoryClient.company || selectedInventoryClient.name,
      name: 'Reporte CSV'
    }, includeInventoryPasswords ? 'Reporte descargado con contraseñas' : 'Reporte descargado sin contraseñas');
  };

  const updateBulkInventoryRow = (index: number, patch: Partial<InventoryDraftRow>) => {
    setBulkInventoryRows(rows => rows.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));
  };

  const addBulkInventoryRow = () => {
    setBulkInventoryRows(rows => [...rows, emptyInventoryRecord()]);
  };

  const duplicateBulkInventoryRow = (index: number) => {
    setBulkInventoryRows(rows => {
      const next = [...rows];
      next.splice(index + 1, 0, { ...rows[index] });
      return next;
    });
  };

  const removeBulkInventoryRow = (index: number) => {
    setBulkInventoryRows(rows => rows.length > 1 ? rows.filter((_, rowIndex) => rowIndex !== index) : [emptyInventoryRecord()]);
  };

  const applyBulkInventoryPaste = () => {
    const rows = bulkPasteText
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        const cells = line.split(/\t|,/).map(cell => cell.trim());
        return {
          type: normalizeInventoryType(cells[0] || ''),
          name: cells[1] || '',
          brand: cells[2] || '',
          model: cells[3] || '',
          serialNumber: cells[4] || '',
          macAddress: (cells[5] || '').toUpperCase(),
          ipAddress: cells[6] || '',
          accessUrl: cells[7] || '',
          username: cells[8] || '',
          password: canAccessInventorySecrets ? (cells[9] || '') : '',
          location: cells[10] || '',
          responsible: cells[11] || '',
          status: normalizeInventoryStatus(cells[12] || ''),
          registeredAt: cells[13] || new Date().toLocaleDateString('en-CA'),
          clientNotes: cells[14] || '',
          internalNotes: cells[15] || ''
        };
      });

    if (rows.length === 0) {
      toast.error('Pega al menos una fila con datos.');
      return;
    }

    setBulkInventoryRows(rows);
    setBulkPasteText('');
    toast.success(`${rows.length} filas listas para revisar`);
  };

  const saveBulkInventoryRecords = async () => {
    if (!selectedInventoryClient) {
      toast.error('Selecciona un cliente para guardar los registros.');
      return;
    }
    if (!canManageInventory) {
      toast.error('Tu usuario no tiene permiso para modificar inventario.');
      return;
    }

    const validRows = bulkInventoryRows.filter(row => row.name.trim());
    if (validRows.length === 0) {
      toast.error('Agrega al menos una fila con nombre de dispositivo o servicio.');
      return;
    }

    try {
      setSavingBulkInventory(true);
      setCloudStatus('Guardando Firebase...');
      for (const row of validRows) {
        const record: ClientInventoryRecord = {
          id: `inv-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          clientId: selectedInventoryClient.id,
          clientName: selectedInventoryClient.company || selectedInventoryClient.name,
          ...row,
          password: canAccessInventorySecrets ? row.password : '',
          updatedAt: new Date().toISOString(),
          createdBy: currentUserProfile?.name,
          updatedBy: currentUserProfile?.name
        };
        await saveSharedInventoryRecord(record);
        await logInventoryAction(record, 'Registro creado por carga rapida');
      }
      setCloudStatus('Firebase guardado');
      toast.success(`${validRows.length} registros guardados`);
      setBulkInventoryRows([emptyInventoryRecord(), emptyInventoryRecord(), emptyInventoryRecord()]);
    } catch (error) {
      console.error('Error saving bulk inventory:', error);
      setCloudStatus('Firebase no guardo');
      toast.error(`No se pudo guardar la carga rapida: ${formatCloudError(error)}`);
    } finally {
      setSavingBulkInventory(false);
    }
  };

  const printInventoryReport = async () => {
    if (!selectedInventoryClient) return;

    const clientLabel = selectedInventoryClient.company || selectedInventoryClient.name;
    const includePasswords = includeInventoryPasswords && canAccessInventorySecrets;
    const statusLabel = (value: ClientInventoryStatus) => inventoryStatuses.find(status => status.value === value)?.label || value;
    const typeLabel = (value: ClientInventoryType) => inventoryTypes.find(type => type.value === value)?.label || value;

    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 14;
    const contentWidth = pageWidth - margin * 2;
    const bottomLimit = pageHeight - 18;
    let y = margin;

    const splitText = (value: unknown, width: number) => doc.splitTextToSize(String(value || '-'), width) as string[];

    const drawSmallHeader = () => {
      doc.setFillColor(15, 23, 42);
      doc.roundedRect(margin, y, contentWidth, 14, 2.5, 2.5, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.text('TECNOPATCH', margin + 5, y + 5.5);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.text('Inventario y accesos del cliente', margin + 5, y + 10);
      doc.text(clientLabel, pageWidth - margin - 5, y + 8, { align: 'right' });
      y += 20;
    };

    const ensurePage = (heightNeeded: number) => {
      if (y + heightNeeded <= bottomLimit) return;
      doc.addPage();
      y = margin;
      drawSmallHeader();
    };

    doc.setProperties({
      title: `Inventario ${clientLabel}`,
      subject: 'Inventario y accesos del cliente',
      author: 'TecnoPatch',
      creator: 'TecnoPatch'
    });

    doc.setFillColor(15, 23, 42);
    doc.roundedRect(margin, y, contentWidth, 42, 3, 3, 'F');
    doc.setFillColor(37, 99, 235);
    doc.rect(margin, y + 39, contentWidth, 3, 'F');
    doc.setTextColor(56, 189, 248);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text('TECNOPATCH', margin + 7, y + 10);
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(21);
    doc.text('Inventario y accesos del cliente', margin + 7, y + 21);
    doc.setFontSize(12);
    doc.text(clientLabel, margin + 7, y + 30);
    doc.setTextColor(203, 213, 225);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    const clientMeta = [
      selectedInventoryClient.name,
      selectedInventoryClient.phone ? `Tel. ${selectedInventoryClient.phone}` : '',
      selectedInventoryClient.email
    ].filter(Boolean).join(' · ');
    doc.text(splitText(clientMeta || 'Cliente TecnoPatch', 108), margin + 7, y + 36);
    doc.setTextColor(219, 234, 254);
    doc.setFontSize(8.5);
    doc.text([
      'Reporte tecnico',
      `Fecha: ${new Date().toLocaleString()}`,
      `Registros: ${filteredInventoryRecords.length}`,
      `Contrasenas: ${includePasswords ? 'incluidas' : 'ocultas'}`
    ], pageWidth - margin - 7, y + 11, { align: 'right', lineHeightFactor: 1.45 });
    y += 52;

    const summary = [
      ['Registros', inventorySummary.total],
      ['Activos', inventorySummary.active],
      ['Mantenimiento', inventorySummary.maintenance],
      ['Baja', inventorySummary.inactive]
    ];
    const summaryGap = 4;
    const summaryWidth = (contentWidth - summaryGap * 3) / 4;
    summary.forEach(([label, value], index) => {
      const x = margin + index * (summaryWidth + summaryGap);
      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(219, 228, 240);
      doc.roundedRect(x, y, summaryWidth, 20, 2.5, 2.5, 'FD');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.8);
      doc.setTextColor(100, 116, 139);
      doc.text(String(label).toUpperCase(), x + 4, y + 7);
      doc.setFontSize(15);
      doc.setTextColor(15, 23, 42);
      doc.text(String(value), x + 4, y + 15);
    });
    y += 30;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(37, 99, 235);
    doc.text('DETALLE DE DISPOSITIVOS, SERVICIOS Y ACCESOS', margin, y);
    y += 6;

    if (filteredInventoryRecords.length === 0) {
      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(203, 213, 225);
      doc.roundedRect(margin, y, contentWidth, 26, 3, 3, 'FD');
      doc.setTextColor(100, 116, 139);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.text('Sin registros para este cliente.', pageWidth / 2, y + 15, { align: 'center' });
      y += 32;
    }

    filteredInventoryRecords.forEach((record, index) => {
      const detailRows = [
        ['Tipo de registro', typeLabel(record.type)],
        ['Estado', statusLabel(record.status)],
        ['Marca', record.brand || '-'],
        ['Modelo', record.model || '-'],
        ['Numero de serie', record.serialNumber || '-'],
        ['Direccion MAC', record.macAddress || '-'],
        ['Direccion IP', record.ipAddress || '-'],
        ['Puerto o URL de acceso', record.accessUrl || '-'],
        ['Usuario', record.username || '-'],
        ['Contrasena', includePasswords ? (record.password || '-') : 'Oculta por seguridad'],
        ['Ubicacion fisica', record.location || '-'],
        ['Responsable', record.responsible || '-'],
        ['Fecha de instalacion / registro', record.registeredAt || '-'],
        ['Ultima actualizacion', record.updatedAt ? new Date(record.updatedAt).toLocaleString() : '-']
      ];
      const colGap = 4;
      const colWidth = (contentWidth - colGap) / 2;
      const valueWidth = colWidth - 8;
      const rowHeights = detailRows.map(([, value]) => Math.max(13, 8 + splitText(value, valueWidth).length * 4));
      const notesLines = splitText(record.clientNotes || 'Sin notas visibles para cliente.', contentWidth - 12);
      const headerHeight = 20;
      const detailsHeight = rowHeights.reduce((acc, height, rowIndex) => rowIndex % 2 === 0 ? acc + Math.max(height, rowHeights[rowIndex + 1] || 0) : acc, 0);
      const notesHeight = 16 + notesLines.length * 4;
      const cardHeight = headerHeight + detailsHeight + notesHeight + 8;

      ensurePage(cardHeight + 5);
      const cardTop = y;
      doc.setDrawColor(219, 228, 240);
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(margin, cardTop, contentWidth, cardHeight, 3, 3, 'FD');
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(margin, cardTop, contentWidth, headerHeight, 3, 3, 'F');
      doc.setDrawColor(226, 232, 240);
      doc.line(margin, cardTop + headerHeight, pageWidth - margin, cardTop + headerHeight);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(37, 99, 235);
      doc.text(`REGISTRO ${index + 1}`, margin + 5, cardTop + 6);
      doc.setTextColor(15, 23, 42);
      doc.setFontSize(12);
      doc.text(splitText(record.name || 'Registro tecnico', contentWidth - 48), margin + 5, cardTop + 13);
      doc.setFillColor(219, 234, 254);
      doc.roundedRect(pageWidth - margin - 34, cardTop + 5, 28, 7, 3, 3, 'F');
      doc.setTextColor(29, 78, 216);
      doc.setFontSize(6.5);
      doc.text(statusLabel(record.status).toUpperCase(), pageWidth - margin - 20, cardTop + 9.5, { align: 'center' });

      let rowY = cardTop + headerHeight;
      for (let i = 0; i < detailRows.length; i += 2) {
        const rowHeight = Math.max(rowHeights[i], rowHeights[i + 1] || 0);
        [0, 1].forEach(offset => {
          const detail = detailRows[i + offset];
          if (!detail) return;
          const x = margin + offset * (colWidth + colGap);
          doc.setDrawColor(226, 232, 240);
          doc.line(x, rowY + rowHeight, x + colWidth, rowY + rowHeight);
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(6.4);
          doc.setTextColor(100, 116, 139);
          doc.text(detail[0].toUpperCase(), x + 4, rowY + 5);
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(8.3);
          doc.setTextColor(15, 23, 42);
          doc.text(splitText(detail[1], valueWidth), x + 4, rowY + 10, { lineHeightFactor: 1.25 });
        });
        rowY += rowHeight;
      }

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.6);
      doc.setTextColor(100, 116, 139);
      doc.text('NOTAS VISIBLES PARA CLIENTE', margin + 5, rowY + 7);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.2);
      doc.setTextColor(51, 65, 85);
      doc.text(notesLines, margin + 5, rowY + 12, { maxWidth: contentWidth - 10, lineHeightFactor: 1.35, align: 'justify' });
      y = cardTop + cardHeight + 6;
    });

    ensurePage(18);
    doc.setDrawColor(226, 232, 240);
    doc.line(margin, y, pageWidth - margin, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text('Las notas internas no se incluyen en este reporte.', margin, y + 6);
    doc.text('Documento generado para control tecnico y operativo del cliente.', margin, y + 11);

    const pages = doc.getNumberOfPages();
    for (let page = 1; page <= pages; page += 1) {
      doc.setPage(page);
      doc.setDrawColor(226, 232, 240);
      doc.line(margin, pageHeight - 12, pageWidth - margin, pageHeight - 12);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(100, 116, 139);
      doc.text('TecnoPatch · Telecomunicaciones · Guadalajara, Jal.', margin, pageHeight - 7);
      doc.text(`Pagina ${page} de ${pages}`, pageWidth - margin, pageHeight - 7, { align: 'right' });
    }

    doc.save(`inventario-${cleanFileNamePart(clientLabel)}-${getLocalDateStamp()}.pdf`);
    await logInventoryAction({
      id: 'reporte',
      clientId: selectedInventoryClient.id,
      clientName: selectedInventoryClient.company || selectedInventoryClient.name,
      name: 'Reporte PDF'
    }, includeInventoryPasswords ? 'Reporte descargado con contraseñas' : 'Reporte descargado sin contraseñas');
    return;
  };

  const restoreQuote = (hist: any) => {
    setQuoteItems(hist.items);
    quoteNumberAuto.current = false;
    setQuoteNumber(hist.quoteNumber || buildNextQuoteNumber(quoteHistory));
    setIncludeIva(hist.includeTax);
    setClientName(hist.clientName || '');
    setClientCompany(hist.clientCompany || '');
    setClientPhone(hist.clientPhone || '');
    setClientEmail(hist.clientEmail || '');
    setClientRfc(hist.clientRfc || '');
    setClientContactRole(hist.clientContactRole || '');
    setProjectType(hist.projectType || 'Residencial');
    setProjectScope(hist.projectScope || '');
    setQuoteNotes(hist.quoteNotes || '');
    setMarginPercent(hist.marginPercent || 30);
    setShowModelsInPdf(false);
    setQuoteStatus(hist.quoteStatus || hist.status || 'Borrador');
    setSalesRep(hist.salesRep || 'TecnoPatch Ventas');
    setValidityDays(hist.validityDays || 15);
    setAdvancePercent(hist.advancePercent || 60);
    setPaymentTerms(hist.paymentTerms || '60% anticipo, 40% contra entrega');
    setNextFollowUpDate(hist.nextFollowUpDate || '');
    setFollowUpNote(hist.followUpNote || '');
    setLostReason(hist.lostReason || '');
    setShowHistory(false);
    toast.info('Quote restored from history');
  };

  const selectQuoteForFollowUp = (quote: QuoteHistoryItem) => {
    setSelectedFollowQuoteId(quote.id);
    setQuoteStatus(quote.quoteStatus || 'Borrador');
    setSalesRep(quote.salesRep || 'TecnoPatch Ventas');
    setValidityDays(quote.validityDays || 15);
    setAdvancePercent(quote.advancePercent || 60);
    setPaymentTerms(quote.paymentTerms || '60% anticipo, 40% contra entrega');
    setNextFollowUpDate(quote.nextFollowUpDate || '');
    setFollowUpNote(quote.followUpNote || '');
    setLostReason(quote.lostReason || '');
  };

  const updateQuoteStatus = async () => {
    if (!selectedFollowQuote) {
      toast.error('Selecciona una cotizacion para actualizar su etapa');
      return;
    }

    try {
      setCloudStatus('Guardando Firebase...');
      await saveSharedQuote({
        ...selectedFollowQuote,
        quoteStatus,
        salesRep,
        validityDays,
        advancePercent,
        paymentTerms,
        nextFollowUpDate,
        followUpNote,
        lostReason: quoteStatus === 'Rechazada' ? lostReason : ''
      });
      setCloudStatus('Firebase guardado');
      toast.success(`Cotizacion movida a ${quoteStatus}`);
    } catch (error) {
      console.error('Error updating quote status:', error);
      setCloudStatus('Firebase no guardo');
      toast.error(`No se pudo actualizar la cotizacion: ${formatCloudError(error)}`);
    }
  };

  return (
    <>
      {!appReady || authLoading ? (
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
      ) : !authReady || !authUser || !currentUserProfile ? (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 font-sans">
          <Toaster position="top-center" richColors duration={2500} closeButton={false} />
          <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl">
            <div className="flex items-center gap-3">
              <span className="w-14 h-14 rounded-2xl bg-slate-950 border border-slate-200 flex items-center justify-center overflow-hidden shadow-sm">
                <img src="/logo.png" alt="TecnoPatch" className="w-full h-full object-contain" />
              </span>
              <div>
                <h1 className="text-2xl font-black tracking-tight text-slate-900">TecnoPatch</h1>
                <p className="text-xs font-black uppercase tracking-[0.22em] text-blue-600">Acceso interno</p>
              </div>
            </div>

            {!authReady ? (
              <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-700">
                Firebase Auth no esta configurado. Revisa variables VITE_FIREBASE_* y habilita Email/Password en Firebase.
              </div>
            ) : (
              <form onSubmit={handleLogin} className="mt-6 space-y-4">
                <div>
                  <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">Correo</label>
                  <Input
                    name="login-email"
                    type="email"
                    autoComplete="email"
                    value={loginForm.email}
                    onChange={e => setLoginForm({ ...loginForm, email: e.target.value })}
                    placeholder="usuario@tecnopatch.com.mx"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">Contraseña</label>
                  <Input
                    name="login-password"
                    type="password"
                    autoComplete="current-password"
                    value={loginForm.password}
                    onChange={e => setLoginForm({ ...loginForm, password: e.target.value })}
                    placeholder="Contraseña"
                  />
                </div>
                <Button type="submit" disabled={loginBusy} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-black">
                  {loginBusy ? 'Entrando...' : 'Entrar al sistema'}
                </Button>
              </form>
            )}
          </div>
        </div>
      ) : (
        <div className="min-h-screen bg-slate-50 flex flex-col font-sans text-slate-900 animate-in fade-in duration-500">
          <div className="print:hidden flex flex-col min-h-screen">
            <Toaster position="top-center" richColors duration={2500} closeButton={false} />

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
        name="mobile-search"
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

      {/* Indicadores compactos */}
      <div className="flex flex-col items-end gap-1 shrink-0">
        <div className={`flex items-center gap-1 max-w-[132px] px-2 py-1 rounded-lg border ${cloudBadgeClass}`}>
          <div className={`w-1.5 h-1.5 rounded-full ${cloudDotClass} animate-pulse`}></div>
          <span className="text-[8px] font-black truncate">{compactCloudStatus}</span>
        </div>
        <div className="flex items-center gap-1 bg-slate-50 px-2 py-1 rounded-lg border border-slate-200">
          <span className="text-[8px] font-black text-slate-500">TC: ${exchangeRate.toFixed(2)}</span>
        </div>
      </div>
    </div>
  </div>

  {/* TODO LO DEMAS - IGUAL QUE EL ORIGINAL (solo desktop) */}
  <div className="hidden md:flex items-center gap-4 w-full md:w-auto overflow-x-auto custom-scrollbar flex-1 justify-end">
    <form onSubmit={handleSearch} className="hidden md:flex flex-1 md:max-w-[300px] lg:max-w-[400px] relative gap-2">
      <div className="flex-1 relative">
        <Input 
          name="desktop-search"
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

    <Button variant="outline" size="sm" className="hidden md:flex gap-2 h-9 p-2 px-3 border-blue-100 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-lg shrink-0 relative" onClick={() => setShowMobileCart(true)}>
      <ShoppingCart size={16} />
      <span className="hidden lg:inline">Cotizacion</span>
      {quoteItems.length > 0 && <span className="absolute -top-1 -right-1 bg-red-500 text-[8px] text-white min-w-4 h-4 px-1 rounded-full flex items-center justify-center">{quoteItems.length}</span>}
    </Button>

    <div className="hidden sm:flex flex-col items-end shrink-0">
      <span className={`text-[9px] px-2 py-0.5 rounded-full font-semibold border whitespace-nowrap ${cloudBadgeClass}`}>
        {cloudStatus}
      </span>
      <span className="text-[9px] text-slate-500 font-bold mt-0.5">TC: ${exchangeRate.toFixed(2)}</span>
    </div>

    <div className="hidden lg:flex items-center gap-2 shrink-0 border-l border-slate-200 pl-3">
      <div className="text-right leading-tight">
        <div className="text-[10px] font-black text-slate-900">{currentUserProfile.name || currentUserProfile.email}</div>
        <div className="text-[9px] font-black uppercase tracking-wider text-blue-600">{currentUserProfile.role}</div>
      </div>
      <Button variant="ghost" size="sm" className="h-8 px-2 text-[10px] font-black" onClick={() => logoutUser()}>
        Salir
      </Button>
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
              <DialogContent className="w-[calc(100vw-1.5rem)] max-w-3xl max-h-[90vh] flex flex-col p-0 overflow-hidden rounded-3xl border-none shadow-2xl">
                <DialogHeader className="p-5 sm:p-6 pb-2 pr-12">
                  <DialogTitle className="text-2xl font-black tracking-tight">Historial de Cotizaciones</DialogTitle>
                  <DialogDescription className="text-slate-500 font-medium">
                    Gestiona y restaura tus cotizaciones previas.
                  </DialogDescription>
                </DialogHeader>
                <div className="flex-1 overflow-y-auto px-4 sm:px-6 pb-6 custom-scrollbar">
                  <Input
                    name="history-search"
                    className="mb-3 h-10"
                    placeholder="Filtrar por cliente, folio, estado, vendedor o producto..."
                    value={globalCrmSearch}
                    onChange={e => setGlobalCrmSearch(e.target.value)}
                  />
                  <div className="space-y-3 pt-2">
                    {filteredQuoteHistory.length === 0 ? (
                      <div className="py-20 flex flex-col items-center justify-center text-slate-400 bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200">
                        <History size={48} className="mb-4 opacity-20" />
                        <p className="font-bold">No hay cotizaciones registradas.</p>
                      </div>
                    ) : (
                      filteredQuoteHistory.map(hist => {
                        const clientLabel = hist.clientCompany || hist.clientName || 'Sin cliente asignado';
                        const itemPreview = hist.items
                          .slice(0, 3)
                          .map(item => `${item.quantity}x ${item.product.titulo || item.product.modelo || 'Partida'}`)
                          .join(' · ');
                        const syscomCount = hist.items.filter(item => !item.product.isManual).length;
                        const manualCount = hist.items.filter(item => item.product.isManual).length;

                        return (
                        <div key={hist.id} className="relative group">
                          <Card
                            className="cursor-pointer hover:border-blue-500 hover:ring-4 hover:ring-blue-50/50 transition-all border-slate-200 shadow-sm"
                            onClick={() => restoreQuote(hist)}
                          >
                            <CardHeader className="py-4 px-4 sm:px-5 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 bg-white border-b border-slate-50 transition-colors group-hover:bg-blue-50/20">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 mb-1 flex-wrap">
                                  <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-100 text-[10px] font-black uppercase">
                                    {(hist as any).quoteNumber || `#${hist.id.toUpperCase()}`}
                                  </Badge>
                                  <Badge className="bg-slate-900 text-white border-slate-900 text-[9px] h-5">{hist.quoteStatus || 'Borrador'}</Badge>
                                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">{hist.date}</span>
                                  <Badge variant="secondary" className="text-[8px] h-4">{hist.currency}</Badge>
                                </div>
                                <div className="font-black text-slate-900 text-base leading-tight line-clamp-1">
                                  {clientLabel}
                                </div>
                                <div className="mt-1 text-[11px] text-slate-500 font-semibold">
                                  {hist.projectType || 'Proyecto'}{hist.salesRep ? ` · ${hist.salesRep}` : ''}
                                </div>
                                <div className="font-black text-slate-900 text-lg">
                                  {hist.total.toLocaleString('es-MX', { style: 'currency', currency: hist.currency || 'MXN' })}
                                </div>
                              </div>
                              <div className="flex shrink-0 flex-row sm:flex-col items-center sm:items-end gap-2 self-end sm:self-start">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  title="Eliminar cotizacion"
                                  className="h-8 w-8 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-full transition-colors"
                                  onClick={(e) => deleteFromHistory(e, hist.id)}
                                >
                                  <Trash size={16} />
                                </Button>
                                <span className="text-[9px] font-bold text-slate-400 uppercase">TC: ${hist.exchangeRate}</span>
                              </div>
                            </CardHeader>
                            <CardContent className="py-3 px-5 bg-slate-50/30 group-hover:bg-white transition-colors">
                              <div className="mb-2 flex flex-wrap gap-2">
                                <Badge variant="secondary" className="text-[10px]">{hist.items.length} partidas</Badge>
                                <Badge variant="secondary" className="text-[10px]">{syscomCount} Syscom</Badge>
                                <Badge variant="secondary" className="text-[10px]">{manualCount} manuales</Badge>
                              </div>
                              <p className="text-xs text-slate-500 font-medium leading-relaxed break-words line-clamp-3">
                                {itemPreview || 'Sin partidas'}
                                {hist.items.length > 3 ? ` · +${hist.items.length - 3} mas` : ''}
                              </p>
                              {hist.projectScope && (
                                <p className="mt-2 text-[11px] text-slate-400 line-clamp-2">{hist.projectScope}</p>
                              )}
                            </CardContent>
                          </Card>
                        </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </DialogContent>
            </Dialog>

            {activeModule === 'cotizador' ? (
            <main className="flex-1 max-w-[2400px] w-full mx-auto flex flex-col h-[100dvh] md:h-[calc(100dvh-110px)] overflow-hidden">

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
                          name="product-brand-filter"
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
                          name="product-sort"
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

                    {shouldShowSearchTip && (
                      <div className="rounded-xl border border-blue-100 bg-blue-50/70 p-3">
                        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                          <p className="text-[11px] font-bold text-blue-900">
                            Para Syscom funciona mejor buscar por modelo, marca o 2-4 palabras clave. Evita pegar la descripcion completa del producto.
                          </p>
                          {searchSuggestions.length > 0 && (
                            <div className="flex flex-wrap gap-2">
                              {searchSuggestions.slice(0, 4).map(suggestion => (
                                <button
                                  key={suggestion}
                                  type="button"
                                  className="rounded-full border border-blue-200 bg-white px-3 py-1 text-[10px] font-black text-blue-700 hover:bg-blue-600 hover:text-white transition-colors"
                                  onClick={() => {
                                    setSearchTerm(suggestion);
                                    fetchProducts(suggestion);
                                  }}
                                >
                                  {suggestion}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 2xl:grid-cols-3 3xl:grid-cols-4 4xl:grid-cols-5 5xl:grid-cols-6 gap-4 md:gap-6 4xl:gap-8 pt-4">
                  {isInitialState ? (
                    <div className="col-span-full py-6 md:py-10 flex flex-col items-center">
                      <div className="w-full max-w-6xl mb-5 flex flex-col gap-2 md:flex-row md:items-end md:justify-between animate-in fade-in slide-in-from-bottom-2 duration-700">
                        <div>
                          <div className="text-[10px] font-black uppercase tracking-[0.22em] text-blue-600">Busqueda por linea de trabajo</div>
                          <h1 className="mt-1 text-2xl md:text-3xl font-black text-slate-900 tracking-tight">Selecciona una categoria para empezar</h1>
                        </div>
                        <p className="max-w-md text-sm text-slate-500 md:text-right">
                          Accesos rapidos para productos Syscom y partidas comunes de instalacion.
                        </p>
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 md:gap-4 w-full max-w-6xl animate-in fade-in zoom-in-95 delay-150 duration-700 fill-mode-both">
                        {[
                          { icon: Camera, label: 'CCTV', hint: 'Camaras, NVR, DVR', query: 'camara ip hikvision', color: 'bg-blue-600' },
                          { icon: Network, label: 'Redes', hint: 'Switches, routers, WiFi', query: 'ubiquiti access point', color: 'bg-emerald-600' },
                          { icon: ShieldAlert, label: 'Alarmas', hint: 'Paneles y sensores', query: 'panel dsc alarma', color: 'bg-red-600' },
                          { icon: CheckCircle2, label: 'Acceso', hint: 'Lectores y controles', query: 'control de acceso', color: 'bg-sky-600' },
                          { icon: Zap, label: 'Energia', hint: 'UPS, fuentes, solar', query: 'ups fuente poder', color: 'bg-amber-600' },
                          { icon: Package, label: 'Cableado', hint: 'UTP, fibra, patch cord', query: 'cable utp cat6', color: 'bg-indigo-600' },
                          { icon: Phone, label: 'Telefonia', hint: 'IP, conmutador, ATA', query: 'telefono ip', color: 'bg-cyan-600' },
                          { icon: ClipboardList, label: 'Canalizacion', hint: 'Tuberia y accesorios', query: 'tuberia conduit', color: 'bg-slate-700' },
                          { icon: Plus, label: 'Partida manual', hint: 'Material, obra o viaticos', query: '__manual__', color: 'bg-slate-900' },
                          { icon: Search, label: 'Busqueda libre', hint: 'Escribe el modelo o marca', query: 'tecnopatch', color: 'bg-blue-500' },
                        ].map((idx, i) => (
                          <button
                            key={i}
                            onClick={() => {
                              if (idx.query === '__manual__') {
                                setShowMobileCart(true);
                                return;
                              }
                              setSearchTerm(idx.query);
                              fetchProducts(idx.query);
                            }}
                            className="group bg-white p-4 md:p-5 rounded-2xl border border-slate-200 shadow-sm hover:shadow-lg hover:border-blue-200 transition-all text-left flex flex-col gap-3 relative overflow-hidden"
                          >
                            <div className={`w-10 h-10 ${idx.color} rounded-xl flex items-center justify-center text-white shadow-md transition-transform group-hover:scale-105 group-hover:rotate-3`}>
                              <idx.icon size={21} strokeWidth={2.4} />
                            </div>
                            <div className="relative z-10">
                              <div className="font-black text-slate-900 text-sm">{idx.label}</div>
                              <div className="mt-1 text-[11px] text-slate-500 font-semibold leading-snug">{idx.hint}</div>
                            </div>
                            <div className="absolute right-3 top-3 text-slate-300 opacity-0 transition-opacity group-hover:opacity-100">
                              <ArrowUp size={14} className="rotate-45" />
                            </div>
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
                            {quoteHistory.slice(0, 2).map((hist) => {
                              const syscomCount = hist.items.filter(item => !item.product.isManual).length;
                              const manualCount = hist.items.filter(item => item.product.isManual).length;
                              const itemPreview = hist.items
                                .slice(0, 2)
                                .map(item => `${item.quantity}x ${item.product.titulo || item.product.modelo || 'Partida'}`)
                                .join(' · ');

                              return (
                              <Card key={hist.id} className="cursor-pointer hover:border-blue-600 hover:shadow-lg transition-all group" onClick={() => restoreQuote(hist)}>
                                <CardContent className="p-4 space-y-3">
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="flex items-start gap-3 min-w-0">
                                      <div className="w-12 h-12 bg-blue-50 rounded-xl flex items-center justify-center text-blue-600 font-black text-xs group-hover:bg-blue-600 group-hover:text-white transition-colors shrink-0">
                                        #{hist.id.slice(0, 2).toUpperCase()}
                                      </div>
                                      <div className="min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                          <span className="text-[10px] font-black text-blue-600 uppercase tracking-widest">{(hist as any).quoteNumber || hist.id.toUpperCase()}</span>
                                          <Badge variant="secondary" className="text-[9px]">{hist.quoteStatus || 'Borrador'}</Badge>
                                        </div>
                                        <div className="text-sm font-black text-slate-900 line-clamp-1">{hist.clientCompany || hist.clientName || 'Sin cliente'}</div>
                                        <div className="text-[10px] text-slate-400">{hist.date}</div>
                                      </div>
                                    </div>
                                    <div className="text-right font-black text-slate-900 text-sm shrink-0">
                                      {hist.total.toLocaleString('es-MX', { style: 'currency', currency: hist.currency || 'MXN' })}
                                    </div>
                                  </div>
                                  <div className="flex flex-wrap gap-2">
                                    <Badge variant="secondary" className="text-[9px]">{hist.items.length} partidas</Badge>
                                    <Badge variant="secondary" className="text-[9px]">{syscomCount} Syscom</Badge>
                                    <Badge variant="secondary" className="text-[9px]">{manualCount} manuales</Badge>
                                  </div>
                                  <p className="text-xs text-slate-500 line-clamp-2">
                                    {itemPreview || 'Sin partidas'}
                                    {hist.items.length > 2 ? ` · +${hist.items.length - 2} mas` : ''}
                                  </p>
                                  {hist.nextFollowUpDate && (
                                    <p className="text-[11px] font-bold text-emerald-600">Proximo seguimiento: {hist.nextFollowUpDate}</p>
                                  )}
                                </CardContent>
                              </Card>
                              );
                            })}
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
              <section className={`bg-white flex flex-col shrink-0 border-l border-slate-200 transition-all duration-300 ease-out overflow-hidden shadow-2xl
            ${showMobileCart
                  ? 'fixed right-0 top-0 bottom-0 z-50 h-[100dvh] w-[min(100vw,390px)] lg:w-[400px] opacity-100 flex'
                  : 'hidden'
                }`}>
                <div className="p-3 border-b border-slate-100 flex items-center justify-between shadow-sm z-20 shrink-0 bg-white">
                  <h3 className="font-bold text-[13px] md:text-[14px] flex items-center gap-2">
                    <ShoppingCart size={18} className="text-blue-600" />
                    Detalle de Cotizacion
                  </h3>
                  <div className="hidden xl:flex flex-wrap items-center gap-1 text-[9px] font-bold text-slate-500">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5">{quoteItems.length} partidas</span>
                    <span className="rounded-full bg-blue-50 text-blue-700 px-2 py-0.5">{syscomItemCount} Syscom</span>
                    <span className="rounded-full bg-emerald-50 text-emerald-700 px-2 py-0.5">{manualItemCount} manuales</span>
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
                            quoteNumberAuto.current = true;
                            setQuoteNumber(buildNextQuoteNumber(quoteHistory));
                            setQuoteNotes('');
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
                    <button className="text-slate-500 hover:text-slate-800" onClick={() => setShowMobileCart(false)}>
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
                      name="manual-title"
                      placeholder="Ej. Tuberia conduit 3/4, mano de obra, configuracion, obra civil..."
                      className="h-9 text-sm"
                      value={manualTitle}
                      onChange={e => setManualTitle(e.target.value)}
                    />

                    <div className="grid grid-cols-2 gap-2">
                      <select
                        name="manual-category"
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
                        name="manual-unit"
                        placeholder="Unidad"
                        className="h-9 text-sm"
                        value={manualUnit}
                        onChange={e => setManualUnit(e.target.value)}
                      />
                    </div>

                    <div className="grid grid-cols-[88px_1fr] gap-2">
                      <Input
                        name="manual-quantity"
                        type="number"
                        min="0.01"
                        step="0.01"
                        inputMode="decimal"
                        className="h-9 text-sm"
                        value={manualQuantity}
                        onChange={e => setManualQuantity(Math.max(0.01, parseFloat(e.target.value) || 1))}
                      />
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-black text-slate-500 uppercase shrink-0">{currency === 'USD' ? 'USD $' : 'MXN $'}</span>
                        <Input
                          name="manual-unit-price"
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
                        const costoDisplay = currency === 'USD' ? costoBase / exchangeRate : costoBase;
                        const precioDisplay = currency === 'USD' ? item.unitPriceMxn / exchangeRate : item.unitPriceMxn;
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
                              {item.product.isManual ? (
                                <div className="flex-1 pr-6 space-y-2">
                                  <Input
                                    name={`quote-title-${item.product.producto_id}`}
                                    className="h-10 px-2 text-[12px] font-bold text-slate-900"
                                    value={item.product.titulo}
                                    onChange={e => updateItemProductField(item.product.producto_id, { titulo: e.target.value })}
                                  />
                                  <div className="grid grid-cols-2 gap-2">
                                    <div>
                                      <label className="mb-1 block text-[9px] font-black uppercase tracking-widest text-slate-400">Categoria</label>
                                      <Input
                                        name={`quote-category-${item.product.producto_id}`}
                                        className="h-9 px-2 text-[11px] font-bold uppercase"
                                        value={item.product.manualCategory || 'Manual'}
                                        onChange={e => updateItemProductField(item.product.producto_id, { manualCategory: e.target.value })}
                                      />
                                    </div>
                                    <div>
                                      <label className="mb-1 block text-[9px] font-black uppercase tracking-widest text-slate-400">Unidad</label>
                                      <Input
                                        name={`quote-unit-${item.product.producto_id}`}
                                        className="h-9 px-2 text-[11px] font-bold"
                                        value={item.product.unit || 'pz'}
                                        onChange={e => updateItemProductField(item.product.producto_id, { unit: e.target.value })}
                                      />
                                    </div>
                                  </div>
                                </div>
                              ) : (
                                <div className="flex-1 pr-6">
                                  <div className="text-[12px] font-medium text-slate-900 line-clamp-2 leading-snug">{item.product.titulo}</div>
                                  <div className="text-[10px] text-slate-500 mt-1 uppercase font-bold">{item.product.modelo}</div>
                                </div>
                              )}
                            </div>

                            <div className="mt-3 grid grid-cols-1 gap-3 border-t pt-3">
                              <label className="mb-[-8px] block text-[9px] font-black uppercase tracking-widest text-slate-400">Cantidad</label>
                              <div className="grid w-full grid-cols-[44px_minmax(96px,1fr)_44px] overflow-hidden rounded-lg border border-slate-200 bg-white">
                                <button onClick={() => updateQuantity(item.product.producto_id, -1)} className="flex h-11 items-center justify-center hover:bg-slate-100 text-slate-500 active:bg-slate-200 transition-colors"><Minus size={16} /></button>
                                <Input
                                  name={`quote-quantity-${item.product.producto_id}`}
                                  type="number"
                                  min="0.01"
                                  step="0.01"
                                  inputMode="decimal"
                                  className="no-number-spinner h-11 min-w-0 rounded-none border-0 border-x bg-slate-50 px-3 text-center font-mono text-[15px] font-black focus-visible:ring-0"
                                  value={item.quantity}
                                  onChange={(e) => updateItemQuantity(item.product.producto_id, parseFloat(e.target.value))}
                                />
                                <button onClick={() => updateQuantity(item.product.producto_id, 1)} className="flex h-11 items-center justify-center hover:bg-slate-100 text-slate-500 active:bg-slate-200 transition-colors"><Plus size={16} /></button>
                              </div>

                              <div className={`grid grid-cols-1 gap-2 ${item.product.isManual ? 'sm:grid-cols-2' : ''}`}>
                                {item.product.isManual && (
                                  <div className="flex flex-col items-stretch">
                                    <label className="mb-1 block text-[9px] font-black uppercase tracking-widest text-slate-400">Costo base</label>
                                    <div className="flex items-center gap-2">
                                      <span className="shrink-0 text-slate-500 text-[10px] font-black uppercase tracking-tighter">{currency === 'USD' ? 'USD $' : 'MXN $'}</span>
                                      <Input
                                        name={`quote-cost-${item.product.producto_id}`}
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        inputMode="decimal"
                                        className="no-number-spinner h-11 min-w-0 flex-1 text-right px-3 font-black text-[15px] border-slate-200 focus:border-blue-500"
                                        value={costoDisplay.toFixed(2)}
                                        onChange={(e) => {
                                          const val = parseFloat(e.target.value) || 0;
                                          updateItemCost(item.product.producto_id, currency === 'USD' ? val * exchangeRate : val);
                                        }}
                                      />
                                    </div>
                                  </div>
                                )}
                                <div className="flex flex-col items-stretch">
                                  <label className="mb-1 block text-[9px] font-black uppercase tracking-widest text-slate-400">Precio venta</label>
                                <div className="flex items-center gap-2">
                                  <span className="shrink-0 text-slate-500 text-[10px] font-black uppercase tracking-tighter">{currency === 'USD' ? 'USD $' : 'MXN $'}</span>
                                  <Input
                                    name={`quote-price-${item.product.producto_id}`}
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    inputMode="decimal"
                                    className="no-number-spinner h-11 min-w-0 flex-1 text-right px-3 font-black text-[15px] border-slate-200 focus:border-blue-500"
                                    value={precioDisplay.toFixed(2)}
                                    onChange={(e) => {
                                      const val = parseFloat(e.target.value) || 0;
                                      updateItemPrice(item.product.producto_id, currency === 'USD' ? val * exchangeRate : val);
                                    }}
                                  />
                                </div>
                                </div>
                              </div>
                                <span className="mt-1 text-right text-[10px] font-bold text-slate-500">
                                  Importe: {(currency === 'USD' ? (item.unitPriceMxn * item.quantity) / exchangeRate : item.unitPriceMxn * item.quantity).toLocaleString('es-MX', { style: 'currency', currency })}
                                </span>
                            </div>

                            {/* MATH SECTION - GANANCIA */}
                            <div className="mt-3 bg-slate-50 rounded p-2 text-[10px] flex justify-between border border-slate-100 items-center gap-2">
                                <div className="text-slate-500">
                                  {item.product.isManual ? 'Partida manual' : 'Syscom'}: <span className="font-bold text-slate-700">
                                    {item.product.isManual ? (item.product.manualCategory || 'Manual') : formatPrice(parseFloat(item.product.precios.precio_descuento))}
                                  </span>
                                </div>
                                <div className="text-slate-400">|</div>
                                <div className={ganancia >= 0 ? "text-emerald-600" : "text-red-500"}>
                                  Ganancia: <span className="font-bold">
                                    {currency === 'USD' ? (ganancia / exchangeRate).toLocaleString('en-US', { style: 'currency', currency: 'USD' }) : ganancia.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })}
                                  </span> ({gananciaPorcentaje.toFixed(1)}%)
                                </div>
                              </div>

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
                    <div className="mt-3 p-3 border border-purple-100 rounded-xl bg-purple-50/60">
                      <button
                        type="button"
                        onClick={suggestComplementaryEquipment}
                        disabled={aiEquipLoading}
                        className="w-full text-[11px] font-black text-purple-700 hover:text-purple-800 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 uppercase tracking-wider"
                      >
                        {aiEquipLoading ? 'Analizando cotizacion...' : '✨ Sugerir equipo complementario'}
                      </button>

                      {aiEquipChecked && aiEquipSuggestions.length > 0 && (
                        <div className="mt-3 space-y-2">
                          {aiEquipSuggestions.map((item, idx) => (
                            <div key={idx} className="flex items-start justify-between gap-2 bg-white rounded-lg border border-purple-100 p-2">
                              <div className="min-w-0">
                                <div className="text-[11px] font-bold text-slate-800 truncate">{item.nombre}</div>
                                <div className="text-[10px] text-slate-500 leading-snug">{item.motivo}</div>
                              </div>
                              <button
                                type="button"
                                onClick={() => searchSuggestion(item.nombre)}
                                className="shrink-0 h-7 px-2.5 text-[10px] font-black uppercase text-purple-700 bg-purple-100 hover:bg-purple-200 rounded-md"
                              >
                                Buscar
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

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
                            <span className="text-[11px] font-bold text-blue-700">PDF interno: mostrar SKU/modelo</span>
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
                        <div>
                          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Folio de cotizacion</label>
                          <Input
                            name="quote-number"
                            placeholder="COT-2026-0001"
                            className="h-9 text-sm font-black uppercase tracking-wider"
                            value={quoteNumber}
                            onChange={e => {
                              quoteNumberAuto.current = false;
                              setQuoteNumber(e.target.value.toUpperCase());
                            }}
                          />
                        </div>
                        {clients.length > 0 && (
                          <select
                            name="quote-saved-client"
                            className="h-9 text-sm border-slate-200 rounded-md bg-blue-50/60 border px-3 text-slate-700 focus-visible:ring-blue-600 outline-none"
                            defaultValue=""
                            onChange={e => {
                              const selectedClient = clients.find(client => client.id === e.target.value);
                              if (selectedClient) {
                                useClientInQuote(selectedClient);
                                e.currentTarget.value = '';
                              }
                            }}
                          >
                            <option value="">Cargar cliente guardado...</option>
                            {clients.map(client => (
                              <option key={client.id} value={client.id}>
                                {client.company || client.name}
                              </option>
                            ))}
                          </select>
                        )}
                        <Input
                          name="quote-client-name"
                          placeholder="Nombre del Cliente / Contacto"
                          className="h-9 text-sm"
                          value={clientName}
                          onChange={e => setClientName(e.target.value)}
                        />
                        <Input
                          name="quote-client-company"
                          placeholder="Empresa o Negocio"
                          className="h-9 text-sm"
                          value={clientCompany}
                          onChange={e => setClientCompany(e.target.value)}
                        />
                        <div className="grid grid-cols-2 gap-2">
                          <Input
                            name="quote-client-phone"
                            placeholder="WhatsApp"
                            className="h-9 text-sm"
                            value={clientPhone}
                            onChange={e => setClientPhone(e.target.value)}
                          />
                          <Input
                            name="quote-client-email"
                            placeholder="Correo"
                            className="h-9 text-sm"
                            value={clientEmail}
                            onChange={e => setClientEmail(e.target.value)}
                          />
                          <Input
                            name="quote-client-rfc"
                            placeholder="RFC"
                            className="h-9 text-sm"
                            value={clientRfc}
                            onChange={e => setClientRfc(e.target.value.toUpperCase())}
                          />
                          <Input
                            name="quote-client-role"
                            placeholder="Contacto / Cargo"
                            className="h-9 text-sm"
                            value={clientContactRole}
                            onChange={e => setClientContactRole(e.target.value)}
                          />
                          <select
                            name="quote-project-type"
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

                        <div className="pt-2">
                          <div className="flex items-center justify-between mb-1.5">
                            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Notas tecnicas / especificaciones para PDF</label>
                            <button
                              type="button"
                              onClick={suggestTechnicalNotes}
                              disabled={aiNotesLoading}
                              className="text-[10px] font-bold text-blue-600 hover:text-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                            >
                              {aiNotesLoading ? 'Generando...' : '✨ Sugerir con IA'}
                            </button>
                          </div>
                          <textarea
                            name="quote-notes"
                            className="w-full text-xs p-3 border border-blue-100 rounded-lg min-h-[110px] focus:ring-1 focus:ring-blue-600 outline-none bg-blue-50/60"
                            placeholder="Ej: Para este nobreak se recomienda validar carga total, voltaje de alimentacion, tipo de clavija electrica y calibre/material requerido antes de instalacion."
                            value={quoteNotes}
                            onChange={e => setQuoteNotes(e.target.value)}
                          />
                        </div>
                      </div>
                    </div>
                </div>

                <div className="p-3 bg-slate-900 text-white mt-auto border-t border-slate-800 shrink-0 shadow-[0_-10px_25px_-5px_rgba(0,0,0,0.3)]">
                  <div className="mb-2 pb-2 border-b border-white/10 flex items-center justify-between">
                    <span className="text-xs lg:text-sm font-semibold">Incluir IVA (16%)</span>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input type="checkbox" className="sr-only peer" checked={includeIva} onChange={(e) => setIncludeIva(e.target.checked)} />
                      <div className="w-10 h-5 lg:w-11 lg:h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-5 lg:peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 lg:after:h-5 lg:after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                    </label>
                  </div>

                  <div className="hidden 2xl:block space-y-1.5 text-[11px] opacity-80 mb-2">
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

                  <div className="flex justify-between items-end text-[16px] font-bold pt-2 border-t border-white/10 mt-2">
                    <div>
                      <span className="block text-[9px] text-slate-400 uppercase tracking-widest">Total</span>
                      <span>TOTAL {currency}</span>
                    </div>
                    <span className="text-blue-400">{total.toLocaleString('es-MX', { style: 'currency', currency: currency })}</span>
                  </div>

                  <div className="flex gap-2 mt-3">
                    <Button
                      className="flex-1 p-2.5 bg-blue-600 hover:bg-blue-700 text-white h-auto rounded-lg font-black uppercase tracking-widest flex gap-2 items-center justify-center text-[10px] shadow-xl shadow-blue-900/30 active:scale-95 transition-all"
                      disabled={quoteItems.length === 0}
                      onClick={saveQuoteToHistory}
                    >
                      <Save size={15} /> Guardar
                    </Button>
                    <Button
                      className="flex-1 p-2.5 bg-white hover:bg-slate-100 text-slate-900 h-auto rounded-lg font-black uppercase tracking-widest flex gap-2 items-center justify-center text-[10px] shadow-lg shadow-black/5 border border-slate-200 active:scale-95 transition-all"
                      disabled={quoteItems.length === 0}
                      onClick={() => {
                        saveQuoteToHistory({ printAfter: true });
                      }}
                    >
                      <Printer size={15} /> Imprimir
                    </Button>
                  </div>

                  <div className="flex gap-2 mt-2">
                    <Button
                      className="flex-1 p-2 bg-slate-800 hover:bg-slate-700 text-white h-auto rounded-lg font-bold flex gap-2 items-center justify-center text-[10px]"
                      disabled={quoteItems.length === 0}
                      onClick={() => setShowPreview(true)}
                    >
                      <FileText size={14} /> Vista Previa
                    </Button>
                    <Button
                      className="flex-1 p-2 bg-emerald-600 hover:bg-emerald-500 text-white h-auto rounded-lg font-bold flex gap-2 items-center justify-center text-[10px]"
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
                {activeModule !== 'inicio' && (
                  <div className="mb-5 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                    <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                      <div>
                        <h1 className="text-base font-black text-slate-900">
                          {activeModule === 'clientes' && 'Clientes'}
                          {activeModule === 'citas' && 'Agenda Comercial'}
                          {activeModule === 'seguimiento' && 'Seguimiento de Cotizaciones'}
                          {activeModule === 'inventario' && 'Inventario y Accesos'}
                          {activeModule === 'usuarios' && 'Usuarios y Accesos'}
                        </h1>
                        <p className="text-xs text-slate-500">Busqueda y resumen rapido del flujo comercial.</p>
                      </div>
                      <div className="relative w-full xl:max-w-md">
                        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <Input
                          name="crm-global-search"
                          className="h-9 pl-9 text-sm"
                          placeholder="Buscar cliente, folio, telefono, vendedor, estado o producto..."
                          value={globalCrmSearch}
                          onChange={e => setGlobalCrmSearch(e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-black">
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-600">Clientes: {activeClients.length}</span>
                      <span className="rounded-full bg-blue-50 px-3 py-1 text-blue-700">Citas pendientes: {pendingMeetings.length}</span>
                      <span className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-700">Hoy: {todayMeetings.length}</span>
                      <span className="rounded-full bg-blue-50 px-3 py-1 text-blue-700">Pipeline: {openPipelineTotal.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })}</span>
                      <span className="rounded-full bg-red-50 px-3 py-1 text-red-600">Atrasados: {overdueFollowUps.length}</span>
                    </div>
                  </div>
                )}

                {activeModule === 'inicio' && (
                  <div className="grid grid-cols-1 xl:grid-cols-[1.1fr_0.9fr] gap-5">
                    <section className="space-y-5">
                      <div className="bg-slate-900 text-white rounded-2xl p-5 shadow-sm overflow-hidden relative">
                        <div className="relative z-10">
                          <p className="text-[10px] font-black uppercase tracking-[0.25em] text-blue-300">Inicio TecnoPatch</p>
                          <h2 className="mt-2 text-2xl md:text-3xl font-black tracking-tight">Centro de trabajo comercial</h2>
                          <p className="mt-2 max-w-2xl text-sm text-slate-300">
                            Revisa lo urgente, retoma cotizaciones y abre rapido el flujo que necesitas para ventas.
                          </p>
                          <div className="mt-5 grid grid-cols-2 md:grid-cols-4 gap-2">
                            <Button onClick={() => setActiveModule('cotizador')} className="bg-blue-600 hover:bg-blue-700 text-white font-black">
                              <ShoppingCart size={16} className="mr-2" /> Cotizar
                            </Button>
                            <Button onClick={() => setActiveModule('clientes')} variant="secondary" className="font-black">
                              <UserPlus size={16} className="mr-2" /> Cliente
                            </Button>
                            <Button onClick={() => setActiveModule('citas')} variant="secondary" className="font-black">
                              <CalendarDays size={16} className="mr-2" /> Cita
                            </Button>
                            <Button onClick={() => setActiveModule('seguimiento')} variant="secondary" className="font-black">
                              <ClipboardList size={16} className="mr-2" /> Pipeline
                            </Button>
                          </div>
                        </div>
                        <div className="absolute -right-14 -bottom-20 h-52 w-52 rounded-full bg-blue-500/20"></div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                          <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-red-500">
                            <Clock3 size={14} /> Urgente
                          </div>
                          <div className="mt-2 text-3xl font-black text-slate-900">{overdueFollowUps.length}</div>
                          <p className="text-xs text-slate-500">seguimientos atrasados</p>
                        </div>
                        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                          <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-blue-600">
                            <FileText size={14} /> Por enviar
                          </div>
                          <div className="mt-2 text-3xl font-black text-slate-900">{quotesToSend.length}</div>
                          <p className="text-xs text-slate-500">cotizaciones en borrador</p>
                        </div>
                        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                          <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-emerald-600">
                            <CheckCircle2 size={14} /> Ganado
                          </div>
                          <div className="mt-2 text-xl font-black text-slate-900">{acceptedTotal.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })}</div>
                          <p className="text-xs text-slate-500">aceptado registrado</p>
                        </div>
                      </div>

                      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                          <div>
                            <h3 className="font-black text-slate-900">Alertas Comerciales</h3>
                            <p className="text-xs text-slate-500">Lo que conviene revisar antes de salir a vender.</p>
                          </div>
                          <Badge variant="secondary">{overdueFollowUps.length + quotesToSend.length + todayMeetings.length} alertas</Badge>
                        </div>
                        <div className="divide-y divide-slate-100">
                          {overdueFollowUps.slice(0, 4).map(quote => (
                            <button key={quote.id} onClick={() => { selectQuoteForFollowUp(quote); setActiveModule('seguimiento'); }} className="w-full p-4 text-left hover:bg-red-50/40 transition-colors">
                              <div className="flex items-center justify-between gap-3">
                                <div>
                                  <p className="text-[10px] font-black uppercase tracking-widest text-red-500">Seguimiento atrasado</p>
                                  <p className="font-black text-slate-900">{quote.clientCompany || quote.clientName || 'Sin cliente'}</p>
                                  <p className="text-xs text-slate-500">{(quote as any).quoteNumber || quote.id.toUpperCase()} · {quote.nextFollowUpDate}</p>
                                </div>
                                <span className="font-black text-red-500">{quote.total.toLocaleString('es-MX', { style: 'currency', currency: quote.currency || 'MXN' })}</span>
                              </div>
                            </button>
                          ))}
                          {todayMeetings.slice(0, 3).map(meeting => (
                            <button key={meeting.id} onClick={() => setActiveModule('citas')} className="w-full p-4 text-left hover:bg-blue-50/40 transition-colors">
                              <p className="text-[10px] font-black uppercase tracking-widest text-blue-600">Cita de hoy</p>
                              <p className="font-black text-slate-900">{meeting.title}</p>
                              <p className="text-xs text-slate-500">{meeting.clientName} · {meeting.time} · {meeting.owner}</p>
                            </button>
                          ))}
                          {overdueFollowUps.length === 0 && todayMeetings.length === 0 && quotesToSend.length === 0 && (
                            <div className="p-5 text-sm font-bold text-slate-400">Sin alertas fuertes por ahora.</div>
                          )}
                        </div>
                      </div>
                    </section>

                    <section className="space-y-5">
                      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                          <h3 className="font-black text-slate-900">Ultimas Cotizaciones</h3>
                          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setShowHistory(true)}>Ver historial</Button>
                        </div>
                        <div className="divide-y divide-slate-100">
                          {quoteHistory.slice(0, 5).map(quote => (
                            <button key={quote.id} onClick={() => restoreQuote(quote)} className="w-full p-4 text-left hover:bg-blue-50/30 transition-colors">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="text-[10px] font-black uppercase tracking-widest text-blue-600">{(quote as any).quoteNumber || quote.id.toUpperCase()}</p>
                                  <p className="font-black text-slate-900 line-clamp-1">{quote.clientCompany || quote.clientName || 'Sin cliente'}</p>
                                  <p className="text-xs text-slate-500">{quote.items.length} partidas · {quote.quoteStatus || 'Borrador'}</p>
                                </div>
                                <span className="font-black text-blue-600 shrink-0">{quote.total.toLocaleString('es-MX', { style: 'currency', currency: quote.currency || 'MXN' })}</span>
                              </div>
                            </button>
                          ))}
                          {quoteHistory.length === 0 && <div className="p-5 text-sm font-bold text-slate-400">Sin cotizaciones guardadas.</div>}
                        </div>
                      </div>

                      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
                        <h3 className="font-black text-slate-900">Radar Comercial</h3>
                        <div className="mt-3 space-y-2 text-sm">
                          <div className="flex justify-between rounded-lg bg-slate-50 px-3 py-2">
                            <span className="text-slate-500">Cotizaciones en seguimiento</span>
                            <span className="font-black text-slate-900">{quotesInFollowUp.length}</span>
                          </div>
                          <div className="flex justify-between rounded-lg bg-slate-50 px-3 py-2">
                            <span className="text-slate-500">Próximos contactos</span>
                            <span className="font-black text-slate-900">{upcomingFollowUps.length}</span>
                          </div>
                          <div className="flex justify-between rounded-lg bg-slate-50 px-3 py-2">
                            <span className="text-slate-500">Pipeline abierto</span>
                            <span className="font-black text-blue-600">{openPipelineTotal.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })}</span>
                          </div>
                        </div>
                      </div>

                      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
                        <h3 className="font-black text-slate-900">Top Categorias</h3>
                        <div className="mt-3 grid grid-cols-2 gap-2">
                          {[
                            { label: 'CCTV', query: 'camara ip hikvision' },
                            { label: 'Redes', query: 'ubiquiti access point' },
                            { label: 'Alarmas', query: 'panel dsc alarma' },
                            { label: 'Acceso', query: 'control de acceso' }
                          ].map(item => (
                            <button key={item.label} onClick={() => { setSearchTerm(item.query); fetchProducts(item.query); setActiveModule('cotizador'); }} className="rounded-lg border border-slate-200 px-3 py-2 text-left text-xs font-black uppercase text-slate-600 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 transition-colors">
                              {item.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </section>
                  </div>
                )}

                {activeModule === 'clientes' && (
                  <div className="grid grid-cols-1 xl:grid-cols-[420px_1fr] gap-5">
                    <section className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm h-fit">
                      <div className="flex items-center justify-between gap-3">
                        <h2 className="text-lg font-black text-slate-900 flex items-center gap-2">
                          <UserPlus size={20} className="text-blue-600" /> {editingClientId ? 'Editar Cliente' : 'Nuevo Cliente'}
                        </h2>
                        {editingClientId && (
                          <Button variant="ghost" size="sm" onClick={resetClientForm} className="text-xs font-black">
                            Cancelar
                          </Button>
                        )}
                      </div>
                      <div className="mt-4 space-y-3">
                        <div>
                          <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">Nombre del contacto</label>
                          <Input name="crm-client-name" placeholder="Ej. Jesus Hernandez" value={newClient.name} onChange={e => setNewClient({ ...newClient, name: e.target.value })} />
                        </div>
                        <div>
                          <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">Empresa / cliente</label>
                          <Input name="crm-client-company" placeholder="Ej. Departamentos Air&b" value={newClient.company} onChange={e => setNewClient({ ...newClient, company: e.target.value })} />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">WhatsApp / telefono</label>
                            <Input name="crm-client-phone" placeholder="33 0000 0000" value={newClient.phone} onChange={e => setNewClient({ ...newClient, phone: e.target.value })} />
                          </div>
                          <div>
                            <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">Correo</label>
                            <Input name="crm-client-email" placeholder="correo@empresa.com" value={newClient.email} onChange={e => setNewClient({ ...newClient, email: e.target.value })} />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">RFC</label>
                            <Input name="crm-client-rfc" placeholder="Opcional" value={newClient.rfc} onChange={e => setNewClient({ ...newClient, rfc: e.target.value.toUpperCase() })} />
                          </div>
                          <div>
                            <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">Cargo / area</label>
                            <Input name="crm-client-role" placeholder="Ej. Administracion" value={newClient.contactRole} onChange={e => setNewClient({ ...newClient, contactRole: e.target.value })} />
                          </div>
                        </div>
                        <div>
                          <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">Direccion del proyecto</label>
                          <Input name="crm-client-address" placeholder="Calle, colonia, ciudad o referencia" value={newClient.address} onChange={e => setNewClient({ ...newClient, address: e.target.value })} />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">Estado del cliente</label>
                            <select name="crm-client-status" className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm" value={newClient.status} onChange={e => setNewClient({ ...newClient, status: e.target.value as ClientRecord['status'] })}>
                              <option>Prospecto</option>
                              <option>Cotizado</option>
                              <option>Seguimiento</option>
                              <option>Cliente</option>
                              <option>Pausado</option>
                            </select>
                          </div>
                          <div>
                            <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">Responsable / vendedor</label>
                            <Input name="crm-client-owner" placeholder="Ej. Raul, Larissa, Ivan" value={newClient.owner} onChange={e => setNewClient({ ...newClient, owner: e.target.value })} />
                          </div>
                        </div>
                        <div>
                          <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">Origen del contacto</label>
                          <Input name="crm-client-source" placeholder="WhatsApp, referido, web, visita..." value={newClient.source} onChange={e => setNewClient({ ...newClient, source: e.target.value })} />
                        </div>
                        <div>
                          <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">Notas internas</label>
                          <textarea name="crm-client-notes" className="w-full min-h-[90px] rounded-lg border border-slate-200 p-3 text-sm outline-none focus:ring-1 focus:ring-blue-600" placeholder="Pendientes, contexto del cliente, horarios, preferencias..." value={newClient.notes} onChange={e => setNewClient({ ...newClient, notes: e.target.value })} />
                        </div>
                        <Button onClick={createClient} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-black">
                          {editingClientId ? <Save size={16} className="mr-2" /> : <UserPlus size={16} className="mr-2" />}
                          {editingClientId ? 'Actualizar Cliente' : 'Guardar Cliente'}
                        </Button>
                      </div>
                    </section>

                    <section className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                      <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                        <h2 className="text-lg font-black text-slate-900">Cartera de Clientes</h2>
                        <Badge variant="secondary">{filteredClients.length} registros</Badge>
                      </div>
                      <div className="divide-y divide-slate-100">
                        {filteredClients.length === 0 ? (
                          <div className="p-10 text-center text-slate-400 font-bold">Aun no hay clientes registrados.</div>
                        ) : filteredClients.map(client => {
                          const clientQuotes = quoteHistory.filter(quote =>
                            (quote.clientCompany && quote.clientCompany === client.company) ||
                            (quote.clientName && quote.clientName === client.name) ||
                            (quote.clientPhone && quote.clientPhone === client.phone)
                          );
                          const clientMeetings = meetings.filter(meeting =>
                            meeting.clientId === client.id ||
                            meeting.clientName === client.company ||
                            meeting.clientName === client.name
                          );
                          const lastQuote = clientQuotes[0];

                          return (
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
                                {client.rfc && <span>RFC: {client.rfc}</span>}
                                {client.contactRole && <span>{client.contactRole}</span>}
                                {client.address && <span className="flex items-center gap-1"><MapPin size={12} /> {client.address}</span>}
                              </div>
                              <div className="mt-3 flex flex-wrap gap-2">
                                <Badge variant="secondary" className="text-[10px]">{clientQuotes.length} cotizaciones</Badge>
                                <Badge variant="secondary" className="text-[10px]">{clientMeetings.length} citas</Badge>
                                {lastQuote && (
                                  <Badge className="bg-emerald-50 text-emerald-700 border-emerald-100 text-[10px]">
                                    Ultima: {lastQuote.total.toLocaleString('es-MX', { style: 'currency', currency: lastQuote.currency || 'MXN' })}
                                  </Badge>
                                )}
                              </div>
                              {(lastQuote || clientMeetings[0]) && (
                                <div className="mt-3 border-l-2 border-blue-100 pl-3 text-xs text-slate-500 space-y-1">
                                  {lastQuote && <p><span className="font-bold text-slate-700">Cotizacion:</span> {(lastQuote as any).quoteNumber || lastQuote.id.toUpperCase()} · {lastQuote.quoteStatus || 'Borrador'}</p>}
                                  {clientMeetings[0] && <p><span className="font-bold text-slate-700">Cita:</span> {clientMeetings[0].date} {clientMeetings[0].time} · {clientMeetings[0].status}</p>}
                                </div>
                              )}
                            </div>
                            <div className="flex gap-2">
                              <Button variant="outline" onClick={() => useClientInQuote(client)}>Usar en cotizacion</Button>
                              <Button variant="secondary" onClick={() => { setNewMeeting({ ...newMeeting, clientId: client.id, location: client.address, owner: client.owner }); setActiveModule('citas'); }}>Agendar</Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-10 w-10 text-slate-500 hover:bg-blue-50 hover:text-blue-600"
                                title="Editar cliente"
                                onClick={() => editClient(client)}
                              >
                                <Pencil size={16} />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-10 w-10 text-slate-400 hover:bg-red-50 hover:text-red-600"
                                title="Eliminar cliente"
                                onClick={() => deleteClient(client)}
                              >
                                <Trash size={16} />
                              </Button>
                            </div>
                          </div>
                          );
                        })}
                      </div>
                    </section>
                  </div>
                )}

                {activeModule === 'citas' && (
                  <div className="grid grid-cols-1 xl:grid-cols-[420px_1fr] gap-5">
                    <section className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm h-fit">
                      <div className="flex items-center justify-between gap-3">
                        <h2 className="text-lg font-black text-slate-900 flex items-center gap-2">
                          <CalendarDays size={20} className="text-blue-600" /> {editingMeetingId ? 'Editar Cita' : 'Nueva Cita'}
                        </h2>
                        {editingMeetingId && (
                          <Button variant="ghost" size="sm" onClick={resetMeetingForm} className="text-xs font-black">
                            Cancelar
                          </Button>
                        )}
                      </div>
                      <div className="mt-4 space-y-3">
                        <div>
                          <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">Cliente relacionado</label>
                          <select className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm" value={newMeeting.clientId} onChange={e => setNewMeeting({ ...newMeeting, clientId: e.target.value })}>
                            <option value="">Cliente de cotizacion actual</option>
                            {clients.map(client => <option key={client.id} value={client.id}>{client.company || client.name}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">Titulo de la cita</label>
                          <Input placeholder="Ej. Visita a sitio, llamada de seguimiento..." value={newMeeting.title} onChange={e => setNewMeeting({ ...newMeeting, title: e.target.value })} />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">Fecha</label>
                            <Input type="date" value={newMeeting.date} onChange={e => setNewMeeting({ ...newMeeting, date: e.target.value })} />
                          </div>
                          <div>
                            <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">Hora</label>
                            <Input type="time" value={newMeeting.time} onChange={e => setNewMeeting({ ...newMeeting, time: e.target.value })} />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">Tipo</label>
                            <select className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm" value={newMeeting.type} onChange={e => setNewMeeting({ ...newMeeting, type: e.target.value as MeetingRecord['type'] })}>
                              <option>Visita tecnica</option>
                              <option>Seguimiento</option>
                              <option>Cierre</option>
                              <option>Instalacion</option>
                              <option>Otro</option>
                            </select>
                          </div>
                          <div>
                            <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">Responsable</label>
                            <Input placeholder="Ventas" value={newMeeting.owner} onChange={e => setNewMeeting({ ...newMeeting, owner: e.target.value })} />
                          </div>
                        </div>
                        <div>
                          <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">Estado de la cita</label>
                          <select className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm" value={newMeeting.status} onChange={e => setNewMeeting({ ...newMeeting, status: e.target.value as MeetingRecord['status'] })}>
                            <option>Programada</option>
                            <option>Realizada</option>
                            <option>Reagendada</option>
                            <option>Cancelada</option>
                          </select>
                        </div>
                        <div>
                          <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">Ubicacion</label>
                          <Input placeholder="Direccion o referencia del punto de encuentro" value={newMeeting.location} onChange={e => setNewMeeting({ ...newMeeting, location: e.target.value })} />
                        </div>
                        <div>
                          <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">Objetivo / pendientes</label>
                          <textarea className="w-full min-h-[90px] rounded-lg border border-slate-200 p-3 text-sm outline-none focus:ring-1 focus:ring-blue-600" placeholder="Ej. Levantamiento, revisar canalizacion, confirmar equipos, medir distancia..." value={newMeeting.notes} onChange={e => setNewMeeting({ ...newMeeting, notes: e.target.value })} />
                        </div>
                        <Button onClick={createMeeting} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-black">
                          {editingMeetingId ? <Save size={16} className="mr-2" /> : <CalendarDays size={16} className="mr-2" />}
                          {editingMeetingId ? 'Actualizar Cita' : 'Programar Cita'}
                        </Button>
                      </div>
                    </section>

                    <section className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                      <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                        <h2 className="text-lg font-black text-slate-900">Agenda Comercial</h2>
                        <Badge variant="secondary">{filteredMeetings.length} citas</Badge>
                      </div>
                      <div className="divide-y divide-slate-100">
                        {filteredMeetings.length === 0 ? (
                          <div className="p-10 text-center text-slate-400 font-bold">Sin citas programadas.</div>
                        ) : filteredMeetings.map(meeting => (
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
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-10 w-10 text-slate-500 hover:bg-blue-50 hover:text-blue-600"
                                title="Editar cita"
                                onClick={() => editMeeting(meeting)}
                              >
                                <Pencil size={16} />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-10 w-10 text-slate-400 hover:bg-red-50 hover:text-red-600"
                                title="Eliminar cita"
                                onClick={() => deleteMeeting(meeting)}
                              >
                                <Trash size={16} />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>
                  </div>
                )}

                {activeModule === 'seguimiento' && (
                  <div className="grid grid-cols-1 xl:grid-cols-[420px_1fr] gap-5">
                    <section className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm h-fit">
                      <h2 className="text-lg font-black text-slate-900 flex items-center gap-2"><ClipboardList size={20} className="text-blue-600" /> Venta Actual</h2>
                      <div className="mt-4 space-y-3">
                        <div>
                          <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">Cotizacion a gestionar</label>
                          <select
                            name="follow-quote"
                            className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm"
                            value={selectedFollowQuoteId}
                            onChange={e => {
                              const quote = quoteHistory.find(item => item.id === e.target.value);
                              if (quote) selectQuoteForFollowUp(quote);
                              else setSelectedFollowQuoteId('');
                            }}
                          >
                            <option value="">Selecciona una cotizacion guardada</option>
                            {filteredQuoteHistory.map(quote => (
                              <option key={quote.id} value={quote.id}>
                                {((quote as any).quoteNumber || quote.id.toUpperCase())} · {quote.clientCompany || quote.clientName || 'Sin cliente'} · {quote.total.toLocaleString('es-MX', { style: 'currency', currency: quote.currency || 'MXN' })}
                              </option>
                            ))}
                          </select>
                        </div>
                        {selectedFollowQuote && (
                          <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-3">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="text-[10px] font-black uppercase tracking-widest text-blue-600">{(selectedFollowQuote as any).quoteNumber || selectedFollowQuote.id.toUpperCase()}</p>
                                <p className="mt-1 font-black text-slate-900">{selectedFollowQuote.clientCompany || selectedFollowQuote.clientName || 'Sin cliente'}</p>
                                <p className="text-xs text-slate-500">{selectedFollowQuote.items.length} partidas · {selectedFollowQuote.date}</p>
                              </div>
                              <p className="font-black text-blue-700">
                                {selectedFollowQuote.total.toLocaleString('es-MX', { style: 'currency', currency: selectedFollowQuote.currency || 'MXN' })}
                              </p>
                            </div>
                          </div>
                        )}
                        <div>
                          <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">Estado comercial</label>
                          <select className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm" value={quoteStatus} onChange={e => setQuoteStatus(e.target.value as typeof quoteStatus)}>
                            {quoteStages.map(status => <option key={status}>{status}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">Responsable</label>
                          <Input placeholder="Vendedor responsable" value={salesRep} onChange={e => setSalesRep(e.target.value)} />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">Vigencia dias</label>
                            <Input type="number" placeholder="15" value={validityDays} onChange={e => setValidityDays(parseInt(e.target.value) || 15)} />
                          </div>
                          <div>
                            <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">Anticipo %</label>
                            <Input type="number" placeholder="60" value={advancePercent} onChange={e => setAdvancePercent(parseInt(e.target.value) || 0)} />
                          </div>
                        </div>
                        <div>
                          <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">Condiciones de pago</label>
                          <Input placeholder="Condiciones de pago" value={paymentTerms} onChange={e => setPaymentTerms(e.target.value)} />
                        </div>
                        <div className="grid grid-cols-1 gap-2">
                          <label className="mb-[-4px] block text-[10px] font-black uppercase tracking-widest text-slate-500">Proximo seguimiento</label>
                          <Input
                            name="follow-up-date"
                            type="date"
                            placeholder="Proximo seguimiento"
                            value={nextFollowUpDate}
                            onChange={e => setNextFollowUpDate(e.target.value)}
                          />
                          <label className="mb-[-4px] mt-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">Nota interna</label>
                          <textarea
                            name="follow-up-note"
                            className="w-full min-h-[78px] rounded-lg border border-slate-200 p-3 text-sm outline-none focus:ring-1 focus:ring-blue-600"
                            placeholder="Nota de seguimiento: llamar, reenviar propuesta, pendiente de anticipo..."
                            value={followUpNote}
                            onChange={e => setFollowUpNote(e.target.value)}
                          />
                          {quoteStatus === 'Rechazada' && (
                            <select
                              name="lost-reason"
                              className="h-10 w-full rounded-md border border-red-100 bg-red-50 px-3 text-sm text-red-700"
                              value={lostReason}
                              onChange={e => setLostReason(e.target.value)}
                            >
                              <option value="">Motivo de rechazo</option>
                              <option>Precio alto</option>
                              <option>Eligio otro proveedor</option>
                              <option>Proyecto pausado</option>
                              <option>Sin respuesta</option>
                              <option>Fuera de alcance</option>
                            </select>
                          )}
                        </div>
                        <Button onClick={updateQuoteStatus} disabled={!selectedFollowQuote} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-black">Actualizar Etapa</Button>
                        <Button onClick={() => selectedFollowQuote ? restoreQuote(selectedFollowQuote) : setActiveModule('cotizador')} variant="outline" className="w-full font-black">
                          {selectedFollowQuote ? 'Cargar al Cotizador' : 'Volver al Cotizador'}
                        </Button>
                      </div>
                    </section>

                    <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      {quoteStages.map(status => (
                        <div key={status} className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                          <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                            <h3 className="font-black text-slate-900">{status}</h3>
                            <Badge variant="secondary">{filteredQuoteHistory.filter(q => ((q as any).quoteStatus || 'Borrador') === status).length}</Badge>
                          </div>
                          <div className="p-4 space-y-3">
                            {filteredQuoteHistory.filter(q => ((q as any).quoteStatus || 'Borrador') === status).slice(0, 8).map(q => (
                              <div
                                key={q.id}
                                role="button"
                                tabIndex={0}
                                onClick={() => selectQuoteForFollowUp(q)}
                                onKeyDown={e => {
                                  if (e.key === 'Enter' || e.key === ' ') selectQuoteForFollowUp(q);
                                }}
                                className={`w-full cursor-pointer text-left rounded-lg border p-3 transition-colors ${selectedFollowQuoteId === q.id ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-100' : 'border-slate-100 hover:border-blue-200 hover:bg-blue-50/30'}`}
                              >
                                <div className="flex justify-between gap-3">
                                  <span className="font-black text-slate-900">{(q as any).quoteNumber || q.id.toUpperCase()}</span>
                                  <div className="flex items-center gap-2">
                                    <span className="font-black text-blue-600">{q.total.toLocaleString('es-MX', { style: 'currency', currency: q.currency || 'MXN' })}</span>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7 text-slate-400 hover:bg-red-50 hover:text-red-600"
                                      title="Eliminar cotizacion"
                                      onClick={e => deleteFromHistory(e, q.id)}
                                    >
                                      <Trash size={14} />
                                    </Button>
                                  </div>
                                </div>
                                <p className="mt-1 text-xs text-slate-500">{q.clientCompany || q.clientName || 'Sin cliente'} · {q.date}</p>
                                {q.nextFollowUpDate && (
                                  <p className={`mt-2 text-[11px] font-bold ${q.nextFollowUpDate < todayIso && !['Aceptada', 'Rechazada'].includes(q.quoteStatus || 'Borrador') ? 'text-red-500' : 'text-emerald-600'}`}>
                                    Proximo contacto: {q.nextFollowUpDate}
                                  </p>
                                )}
                                <p className="mt-2 text-[11px] text-slate-400 line-clamp-2">
                                  {q.items.slice(0, 2).map(item => item.product.titulo || item.product.modelo).join(' · ')}
                                  {q.items.length > 2 ? ` · +${q.items.length - 2} mas` : ''}
                                </p>
                                {q.followUpNote && <p className="mt-2 text-[11px] text-slate-500 line-clamp-2">{q.followUpNote}</p>}
                                {q.lostReason && <Badge className="mt-2 bg-red-50 text-red-700 border-red-100">{q.lostReason}</Badge>}
                              </div>
                            ))}
                            {filteredQuoteHistory.filter(q => ((q as any).quoteStatus || 'Borrador') === status).length === 0 && (
                              <p className="text-sm text-slate-400 font-bold">Sin cotizaciones en esta etapa.</p>
                            )}
                          </div>
                        </div>
                      ))}
                    </section>
                  </div>
                )}

                {activeModule === 'inventario' && (
                  <div className="grid grid-cols-1 2xl:grid-cols-[420px_1fr] gap-5">
                    <section className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm h-fit">
                      <div className="flex items-center justify-between gap-3">
                        <h2 className="text-lg font-black text-slate-900 flex items-center gap-2">
                          <KeyRound size={20} className="text-blue-600" /> {editingInventoryId ? 'Editar Registro' : 'Agregar Registro'}
                        </h2>
                        {editingInventoryId && (
                          <Button variant="ghost" size="sm" onClick={resetInventoryForm} className="text-xs font-black">
                            Cancelar
                          </Button>
                        )}
                      </div>

                      <div className="mt-4 space-y-3">
                        <div>
                          <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">Cliente</label>
                          <select
                            className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm"
                            value={selectedInventoryClientId}
                            onChange={e => {
                              setSelectedInventoryClientId(e.target.value);
                              resetInventoryForm();
                            }}
                          >
                            <option value="">Seleccionar cliente...</option>
                            {clients.map(client => <option key={client.id} value={client.id}>{client.company || client.name}</option>)}
                          </select>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">Tipo</label>
                            <select className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm" value={newInventoryRecord.type} onChange={e => setNewInventoryRecord({ ...newInventoryRecord, type: e.target.value as ClientInventoryType })}>
                              {inventoryTypes.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">Estado</label>
                            <select className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm" value={newInventoryRecord.status} onChange={e => setNewInventoryRecord({ ...newInventoryRecord, status: e.target.value as ClientInventoryStatus })}>
                              {inventoryStatuses.map(status => <option key={status.value} value={status.value}>{status.label}</option>)}
                            </select>
                          </div>
                        </div>

                        <div>
                          <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">Nombre del dispositivo o servicio</label>
                          <Input placeholder="Ej. DVR principal, correo administracion, modem fibra..." value={newInventoryRecord.name} onChange={e => setNewInventoryRecord({ ...newInventoryRecord, name: e.target.value })} />
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">Marca</label>
                            <Input placeholder="Hikvision, Ubiquiti..." value={newInventoryRecord.brand} onChange={e => setNewInventoryRecord({ ...newInventoryRecord, brand: e.target.value })} />
                          </div>
                          <div>
                            <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">Modelo</label>
                            <Input placeholder="Modelo / SKU" value={newInventoryRecord.model} onChange={e => setNewInventoryRecord({ ...newInventoryRecord, model: e.target.value })} />
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">Serie</label>
                            <Input placeholder="Numero de serie" value={newInventoryRecord.serialNumber} onChange={e => setNewInventoryRecord({ ...newInventoryRecord, serialNumber: e.target.value })} />
                          </div>
                          <div>
                            <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">MAC</label>
                            <Input placeholder="AA:BB:CC:DD:EE:FF" value={newInventoryRecord.macAddress} onChange={e => setNewInventoryRecord({ ...newInventoryRecord, macAddress: e.target.value.toUpperCase() })} />
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">IP</label>
                            <Input placeholder="192.168.1.10" value={newInventoryRecord.ipAddress} onChange={e => setNewInventoryRecord({ ...newInventoryRecord, ipAddress: e.target.value })} />
                          </div>
                          <div>
                            <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">Puerto / URL</label>
                            <Input placeholder=":8080, https://..." value={newInventoryRecord.accessUrl} onChange={e => setNewInventoryRecord({ ...newInventoryRecord, accessUrl: e.target.value })} />
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">Usuario</label>
                            <Input placeholder="admin, correo, usuario..." value={newInventoryRecord.username} onChange={e => setNewInventoryRecord({ ...newInventoryRecord, username: e.target.value })} />
                          </div>
                          <div>
                            <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">Contraseña</label>
                            <Input
                              type="password"
                              placeholder={canAccessInventorySecrets ? 'Solo visible para admin' : 'Solo admin puede editar'}
                              value={newInventoryRecord.password}
                              disabled={!canAccessInventorySecrets}
                              onChange={e => setNewInventoryRecord({ ...newInventoryRecord, password: e.target.value })}
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">Ubicacion fisica</label>
                            <Input placeholder="Recepcion, rack, caja..." value={newInventoryRecord.location} onChange={e => setNewInventoryRecord({ ...newInventoryRecord, location: e.target.value })} />
                          </div>
                          <div>
                            <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">Responsable</label>
                            <Input placeholder="Persona que usa o cuida el equipo" value={newInventoryRecord.responsible} onChange={e => setNewInventoryRecord({ ...newInventoryRecord, responsible: e.target.value })} />
                          </div>
                        </div>

                        <div>
                          <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">Fecha de instalacion / registro</label>
                          <Input type="date" value={newInventoryRecord.registeredAt} onChange={e => setNewInventoryRecord({ ...newInventoryRecord, registeredAt: e.target.value })} />
                        </div>

                        <div>
                          <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">Notas visibles para cliente</label>
                          <textarea className="w-full min-h-[70px] rounded-lg border border-slate-200 p-3 text-sm outline-none focus:ring-1 focus:ring-blue-600" placeholder="Notas que si pueden salir en reporte para cliente..." value={newInventoryRecord.clientNotes} onChange={e => setNewInventoryRecord({ ...newInventoryRecord, clientNotes: e.target.value })} />
                        </div>
                        <div>
                          <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">Notas internas</label>
                          <textarea className="w-full min-h-[70px] rounded-lg border border-slate-200 p-3 text-sm outline-none focus:ring-1 focus:ring-blue-600" placeholder="Claves de contexto, pendientes internos, condiciones especiales..." value={newInventoryRecord.internalNotes} onChange={e => setNewInventoryRecord({ ...newInventoryRecord, internalNotes: e.target.value })} />
                        </div>

                        <Button onClick={saveInventoryRecord} disabled={!canManageInventory || !selectedInventoryClientId} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-black">
                          <Save size={16} className="mr-2" />
                          {editingInventoryId ? 'Actualizar Registro' : 'Guardar Registro'}
                        </Button>
                        {!canAccessInventorySecrets && (
                          <p className="text-[11px] text-slate-500">Tu rol puede crear/editar registros, pero las contraseñas solo las administra un usuario admin.</p>
                        )}
                      </div>
                    </section>

                    <section className="space-y-4 min-w-0">
                      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
                        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
                          <div>
                            <h2 className="text-lg font-black text-slate-900">Inventario y Accesos del Cliente</h2>
                            <p className="text-sm text-slate-500">{selectedInventoryClient ? selectedInventoryClient.company || selectedInventoryClient.name : 'Selecciona un cliente para consultar sus registros tecnicos.'}</p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-black text-slate-600">
                              <input type="checkbox" checked={includeInventoryPasswords} disabled={!canAccessInventorySecrets} onChange={e => setIncludeInventoryPasswords(e.target.checked)} />
                              Incluir contraseñas
                            </label>
                            <Button variant="outline" onClick={downloadInventoryCsv} disabled={!selectedInventoryClient || filteredInventoryRecords.length === 0}>
                              <Download size={15} className="mr-2" /> Excel
                            </Button>
                            <Button onClick={printInventoryReport} disabled={!selectedInventoryClient} className="bg-slate-900 hover:bg-slate-800 text-white">
                              <Printer size={15} className="mr-2" /> PDF
                            </Button>
                          </div>
                        </div>

                        <div className="mt-4 grid grid-cols-2 lg:grid-cols-4 gap-3">
                          <div className="rounded-xl bg-slate-50 border border-slate-100 p-3">
                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Registros</p>
                            <p className="text-2xl font-black text-slate-900">{inventorySummary.total}</p>
                          </div>
                          <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-3">
                            <p className="text-[10px] font-black uppercase tracking-widest text-emerald-700">Activos</p>
                            <p className="text-2xl font-black text-emerald-700">{inventorySummary.active}</p>
                          </div>
                          <div className="rounded-xl bg-amber-50 border border-amber-100 p-3">
                            <p className="text-[10px] font-black uppercase tracking-widest text-amber-700">Mantenimiento</p>
                            <p className="text-2xl font-black text-amber-700">{inventorySummary.maintenance}</p>
                          </div>
                          <div className="rounded-xl bg-red-50 border border-red-100 p-3">
                            <p className="text-[10px] font-black uppercase tracking-widest text-red-700">Baja</p>
                            <p className="text-2xl font-black text-red-700">{inventorySummary.inactive}</p>
                          </div>
                        </div>
                      </div>

                      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                        <div className="p-4 border-b border-slate-100 flex flex-col xl:flex-row xl:items-center justify-between gap-3">
                          <div>
                            <h3 className="font-black text-slate-900 flex items-center gap-2">
                              <Package size={18} className="text-blue-600" /> Carga rapida en tabla
                            </h3>
                            <p className="text-xs text-slate-500">Captura varios equipos o pega filas desde Excel: tipo, nombre, marca, modelo, serie, MAC, IP, URL, usuario, contraseña, ubicación, responsable, estado, fecha, notas cliente, notas internas.</p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button variant="outline" onClick={addBulkInventoryRow} disabled={!selectedInventoryClientId}>
                              <Plus size={15} className="mr-2" /> Fila
                            </Button>
                            <Button onClick={saveBulkInventoryRecords} disabled={!selectedInventoryClientId || savingBulkInventory || !canManageInventory} className="bg-blue-600 hover:bg-blue-700 text-white">
                              <Save size={15} className="mr-2" /> {savingBulkInventory ? 'Guardando...' : 'Guardar todos'}
                            </Button>
                          </div>
                        </div>

                        <div className="p-4 border-b border-slate-100 grid grid-cols-1 xl:grid-cols-[1fr_auto] gap-2">
                          <textarea
                            className="min-h-[64px] rounded-lg border border-slate-200 p-3 text-xs outline-none focus:ring-1 focus:ring-blue-600"
                            placeholder="Pega filas desde Excel/Sheets. Orden: tipo, nombre, marca, modelo, serie, MAC, IP, URL, usuario, contraseña, ubicación, responsable, estado, fecha, notas cliente, notas internas."
                            value={bulkPasteText}
                            onChange={e => setBulkPasteText(e.target.value)}
                          />
                          <Button variant="secondary" onClick={applyBulkInventoryPaste} disabled={!bulkPasteText.trim()} className="font-black">
                            Aplicar pegado
                          </Button>
                        </div>

                        <div className="overflow-x-auto">
                          <table className="w-full min-w-[1320px] text-xs">
                            <thead className="bg-slate-50 text-slate-500">
                              <tr>
                                <th className="px-2 py-2 text-left font-black uppercase">Tipo</th>
                                <th className="px-2 py-2 text-left font-black uppercase">Nombre</th>
                                <th className="px-2 py-2 text-left font-black uppercase">Marca</th>
                                <th className="px-2 py-2 text-left font-black uppercase">Modelo</th>
                                <th className="px-2 py-2 text-left font-black uppercase">Serie</th>
                                <th className="px-2 py-2 text-left font-black uppercase">MAC</th>
                                <th className="px-2 py-2 text-left font-black uppercase">IP</th>
                                <th className="px-2 py-2 text-left font-black uppercase">URL</th>
                                <th className="px-2 py-2 text-left font-black uppercase">Usuario</th>
                                <th className="px-2 py-2 text-left font-black uppercase">Contraseña</th>
                                <th className="px-2 py-2 text-left font-black uppercase">Ubicacion</th>
                                <th className="px-2 py-2 text-left font-black uppercase">Estado</th>
                                <th className="px-2 py-2 text-right font-black uppercase">Acciones</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {bulkInventoryRows.map((row, index) => (
                                <tr key={index} className="hover:bg-slate-50">
                                  <td className="px-2 py-2">
                                    <select className="h-9 w-32 rounded-md border border-slate-200 px-2" value={row.type} onChange={e => updateBulkInventoryRow(index, { type: e.target.value as ClientInventoryType })}>
                                      {inventoryTypes.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}
                                    </select>
                                  </td>
                                  <td className="px-2 py-2"><Input className="h-9 w-48 text-xs" value={row.name} onChange={e => updateBulkInventoryRow(index, { name: e.target.value })} placeholder="Nombre" /></td>
                                  <td className="px-2 py-2"><Input className="h-9 w-32 text-xs" value={row.brand} onChange={e => updateBulkInventoryRow(index, { brand: e.target.value })} placeholder="Marca" /></td>
                                  <td className="px-2 py-2"><Input className="h-9 w-36 text-xs" value={row.model} onChange={e => updateBulkInventoryRow(index, { model: e.target.value })} placeholder="Modelo" /></td>
                                  <td className="px-2 py-2"><Input className="h-9 w-36 text-xs" value={row.serialNumber} onChange={e => updateBulkInventoryRow(index, { serialNumber: e.target.value })} placeholder="Serie" /></td>
                                  <td className="px-2 py-2"><Input className="h-9 w-36 text-xs" value={row.macAddress} onChange={e => updateBulkInventoryRow(index, { macAddress: e.target.value.toUpperCase() })} placeholder="MAC" /></td>
                                  <td className="px-2 py-2"><Input className="h-9 w-32 text-xs" value={row.ipAddress} onChange={e => updateBulkInventoryRow(index, { ipAddress: e.target.value })} placeholder="IP" /></td>
                                  <td className="px-2 py-2"><Input className="h-9 w-40 text-xs" value={row.accessUrl} onChange={e => updateBulkInventoryRow(index, { accessUrl: e.target.value })} placeholder="URL/puerto" /></td>
                                  <td className="px-2 py-2"><Input className="h-9 w-32 text-xs" value={row.username} onChange={e => updateBulkInventoryRow(index, { username: e.target.value })} placeholder="Usuario" /></td>
                                  <td className="px-2 py-2">
                                    <Input
                                      className="h-9 w-36 text-xs"
                                      type="password"
                                      value={row.password}
                                      disabled={!canAccessInventorySecrets}
                                      onChange={e => updateBulkInventoryRow(index, { password: e.target.value })}
                                      placeholder={canAccessInventorySecrets ? 'Contraseña' : 'Admin'}
                                    />
                                  </td>
                                  <td className="px-2 py-2"><Input className="h-9 w-36 text-xs" value={row.location} onChange={e => updateBulkInventoryRow(index, { location: e.target.value })} placeholder="Ubicacion" /></td>
                                  <td className="px-2 py-2">
                                    <select className="h-9 w-32 rounded-md border border-slate-200 px-2" value={row.status} onChange={e => updateBulkInventoryRow(index, { status: e.target.value as ClientInventoryStatus })}>
                                      {inventoryStatuses.map(status => <option key={status.value} value={status.value}>{status.label}</option>)}
                                    </select>
                                  </td>
                                  <td className="px-2 py-2">
                                    <div className="flex justify-end gap-1">
                                      <Button variant="ghost" size="icon" className="h-8 w-8" title="Duplicar fila" onClick={() => duplicateBulkInventoryRow(index)}>
                                        <Copy size={13} />
                                      </Button>
                                      <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-red-50 hover:text-red-600" title="Eliminar fila" onClick={() => removeBulkInventoryRow(index)}>
                                        <Trash size={13} />
                                      </Button>
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
                        <div className="grid grid-cols-1 lg:grid-cols-[1fr_160px_160px_160px] gap-2">
                          <Input placeholder="Buscar por nombre, IP, MAC, usuario, marca..." value={inventorySearch} onChange={e => setInventorySearch(e.target.value)} />
                          <select className="h-10 rounded-md border border-slate-200 px-3 text-sm" value={inventoryTypeFilter} onChange={e => setInventoryTypeFilter(e.target.value)}>
                            <option>Todos</option>
                            {inventoryTypes.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}
                          </select>
                          <select className="h-10 rounded-md border border-slate-200 px-3 text-sm" value={inventoryStatusFilter} onChange={e => setInventoryStatusFilter(e.target.value)}>
                            <option>Todos</option>
                            {inventoryStatuses.map(status => <option key={status.value} value={status.value}>{status.label}</option>)}
                          </select>
                          <select className="h-10 rounded-md border border-slate-200 px-3 text-sm" value={inventoryLocationFilter} onChange={e => setInventoryLocationFilter(e.target.value)}>
                            <option>Todas</option>
                            {inventoryLocations.map(location => <option key={location}>{location}</option>)}
                          </select>
                        </div>
                      </div>

                      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead className="bg-slate-900 text-white">
                              <tr>
                                <th className="px-3 py-3 text-left text-[10px] uppercase tracking-widest">Registro</th>
                                <th className="px-3 py-3 text-left text-[10px] uppercase tracking-widest">Red / Acceso</th>
                                <th className="px-3 py-3 text-left text-[10px] uppercase tracking-widest">Usuario</th>
                                <th className="px-3 py-3 text-left text-[10px] uppercase tracking-widest">Contraseña</th>
                                <th className="px-3 py-3 text-left text-[10px] uppercase tracking-widest">Ubicacion</th>
                                <th className="px-3 py-3 text-right text-[10px] uppercase tracking-widest">Acciones</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {filteredInventoryRecords.length === 0 ? (
                                <tr><td colSpan={6} className="p-8 text-center text-slate-400 font-bold">Sin registros para este cliente.</td></tr>
                              ) : filteredInventoryRecords.map(record => (
                                <tr key={record.id} className="hover:bg-slate-50">
                                  <td className="px-3 py-3 align-top">
                                    <div className="font-black text-slate-900">{record.name}</div>
                                    <div className="text-xs text-slate-500">{inventoryTypes.find(type => type.value === record.type)?.label} · {record.brand || 'Sin marca'} {record.model}</div>
                                    <div className="mt-1 flex flex-wrap gap-1">
                                      <Badge variant="secondary" className="text-[10px]">{record.status}</Badge>
                                      {record.serialNumber && <Badge variant="outline" className="text-[10px]">Serie: {record.serialNumber}</Badge>}
                                    </div>
                                  </td>
                                  <td className="px-3 py-3 align-top text-xs text-slate-600">
                                    <div>IP: <span className="font-bold">{record.ipAddress || '-'}</span></div>
                                    <div>MAC: <span className="font-bold">{record.macAddress || '-'}</span></div>
                                    <div className="max-w-[220px] truncate">URL: {record.accessUrl || '-'}</div>
                                  </td>
                                  <td className="px-3 py-3 align-top">
                                    <div className="flex items-center gap-2">
                                      <span className="font-bold text-slate-700">{record.username || '-'}</span>
                                      {record.username && (
                                        <Button variant="ghost" size="icon" className="h-7 w-7" title="Copiar usuario" onClick={() => copyInventoryValue(record, record.username, 'Usuario copiado', 'Usuario')}>
                                          <Copy size={13} />
                                        </Button>
                                      )}
                                    </div>
                                  </td>
                                  <td className="px-3 py-3 align-top">
                                    <div className="flex items-center gap-2">
                                      <span className="font-bold text-slate-700">{visiblePasswords[record.id] && canAccessInventorySecrets ? record.password || '-' : '••••••••'}</span>
                                      <Button variant="ghost" size="icon" className="h-7 w-7" title="Ver contraseña" disabled={!canAccessInventorySecrets || !record.password} onClick={() => revealInventoryPassword(record)}>
                                        <Eye size={13} />
                                      </Button>
                                      <Button variant="ghost" size="icon" className="h-7 w-7" title="Copiar contraseña" disabled={!canAccessInventorySecrets || !record.password} onClick={() => copyInventoryValue(record, record.password, 'Contraseña copiada', 'Contraseña')}>
                                        <Copy size={13} />
                                      </Button>
                                    </div>
                                  </td>
                                  <td className="px-3 py-3 align-top text-xs text-slate-600">
                                    <div className="font-bold">{record.location || '-'}</div>
                                    <div>{record.responsible || ''}</div>
                                    {record.clientNotes && <div className="mt-1 max-w-[220px] text-slate-500 line-clamp-2">{record.clientNotes}</div>}
                                  </td>
                                  <td className="px-3 py-3 align-top">
                                    <div className="flex justify-end gap-1">
                                      <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-blue-50 hover:text-blue-600" onClick={() => editInventoryRecord(record)}>
                                        <Pencil size={14} />
                                      </Button>
                                      <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-red-50 hover:text-red-600" disabled={!canManageInventory} onClick={() => deleteInventoryRecord(record)}>
                                        <Trash size={14} />
                                      </Button>
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                        <div className="p-4 border-b border-slate-100 flex items-center gap-2">
                          <ShieldCheck size={18} className="text-blue-600" />
                          <h3 className="font-black text-slate-900">Bitacora de Accesos</h3>
                        </div>
                        <div className="divide-y divide-slate-100 max-h-72 overflow-auto">
                          {inventoryLogs.length === 0 ? (
                            <div className="p-5 text-sm font-bold text-slate-400">Sin movimientos registrados para este cliente.</div>
                          ) : inventoryLogs.map(log => (
                            <div key={log.id} className="p-3 text-sm">
                              <div className="flex items-center justify-between gap-3">
                                <span className="font-black text-slate-900">{log.action}</span>
                                <span className="text-[11px] text-slate-400">{new Date(log.createdAt).toLocaleString()}</span>
                              </div>
                              <p className="text-xs text-slate-500">{log.recordName} · {log.userName || log.userEmail}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    </section>
                  </div>
                )}

                {activeModule === 'usuarios' && isAdmin && (
                  <div className="grid grid-cols-1 xl:grid-cols-[420px_1fr] gap-5">
                    <section className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm h-fit">
                      <h2 className="text-lg font-black text-slate-900 flex items-center gap-2">
                        <UserPlus size={20} className="text-blue-600" /> Nuevo Usuario
                      </h2>
                      <div className="mt-4 space-y-3">
                        <div>
                          <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">Nombre</label>
                          <Input
                            name="team-user-name"
                            placeholder="Ej. Raul Ventas"
                            value={newTeamUser.name}
                            onChange={e => setNewTeamUser({ ...newTeamUser, name: e.target.value })}
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">Correo de acceso</label>
                          <Input
                            name="team-user-email"
                            type="email"
                            autoComplete="off"
                            placeholder="usuario@tecnopatch.com.mx"
                            value={newTeamUser.email}
                            onChange={e => setNewTeamUser({ ...newTeamUser, email: e.target.value })}
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">Contraseña temporal</label>
                          <Input
                            name="team-user-password"
                            type="password"
                            autoComplete="new-password"
                            placeholder="Minimo 6 caracteres"
                            value={newTeamUser.password}
                            onChange={e => setNewTeamUser({ ...newTeamUser, password: e.target.value })}
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">Rol</label>
                          <select
                            name="team-user-role"
                            className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm"
                            value={newTeamUser.role}
                            onChange={e => setNewTeamUser({ ...newTeamUser, role: e.target.value as UserProfile['role'] })}
                          >
                            <option value="ventas">Ventas</option>
                            <option value="lectura">Solo lectura</option>
                            <option value="admin">Admin</option>
                          </select>
                        </div>
                        <Button onClick={createTeamUser} disabled={creatingTeamUser} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-black">
                          <UserPlus size={16} className="mr-2" />
                          {creatingTeamUser ? 'Creando...' : 'Crear Usuario'}
                        </Button>
                        <p className="text-[11px] text-slate-500 leading-relaxed">
                          El usuario queda activo en Firebase Auth y en la lista de accesos. Si alguien sale del equipo, desactivalo aqui.
                        </p>
                      </div>
                    </section>

                    <section className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                      <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                        <h2 className="text-lg font-black text-slate-900">Equipo TecnoPatch</h2>
                        <Badge variant="secondary">{teamUsers.length} usuarios</Badge>
                      </div>
                      <div className="divide-y divide-slate-100">
                        {teamUsers.length === 0 ? (
                          <div className="p-10 text-center text-slate-400 font-bold">Aun no hay usuarios registrados.</div>
                        ) : teamUsers.map(user => (
                          <div key={user.uid} className="p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3 hover:bg-slate-50">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <h3 className="font-black text-slate-900">{user.name || user.email}</h3>
                                <Badge className={user.active ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-red-50 text-red-700 border-red-100'}>
                                  {user.active ? 'Activo' : 'Inactivo'}
                                </Badge>
                                <Badge variant="secondary">{user.role}</Badge>
                              </div>
                              <p className="text-sm text-slate-500">{user.email}</p>
                              <p className="mt-1 text-[11px] text-slate-400">Alta: {new Date(user.createdAt).toLocaleString('es-MX')}</p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <select
                                className="h-9 rounded-md border border-slate-200 px-2 text-xs font-bold"
                                value={user.role}
                                onChange={e => changeUserRole(user, e.target.value as UserProfile['role'])}
                                disabled={user.uid === currentUserProfile.uid}
                              >
                                <option value="ventas">Ventas</option>
                                <option value="lectura">Solo lectura</option>
                                <option value="admin">Admin</option>
                              </select>
                              <Button
                                variant={user.active ? 'outline' : 'secondary'}
                                size="sm"
                                className="font-black"
                                onClick={() => toggleUserActive(user)}
                                disabled={user.uid === currentUserProfile.uid}
                              >
                                {user.active ? 'Desactivar' : 'Activar'}
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
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
              clientPhone={clientPhone}
              clientEmail={clientEmail}
              clientRfc={clientRfc}
              clientContactRole={clientContactRole}
              projectType={projectType}
              subtotal={subtotal}
              tax={tax}
              total={total}
              includeIva={includeIva}
              exchangeRate={exchangeRate}
              projectScope={projectScope}
              quoteNotes={quoteNotes}
              showModels={showModelsInPdf}
              currency={currency}
              quoteNumber={quoteNumber}
            />
          </div>

          {/* Preview Dialog */}
          <Dialog open={showPreview} onOpenChange={setShowPreview}>
            <DialogContent className="print:hidden max-w-[1280px] w-[96vw] h-[96vh] flex flex-col p-0 overflow-hidden bg-slate-100 rounded-none sm:rounded-xl">
              <DialogHeader className="p-4 border-b bg-white shrink-0 flex flex-row items-center justify-between">
                <DialogTitle>Vista Previa del Documento</DialogTitle>
              </DialogHeader>
              <div className="flex-1 overflow-auto p-3 md:p-6 bg-slate-400/20 text-left relative">
                <div className="mx-auto h-fit bg-white shadow-2xl preview-document">
                  <QuoteDocument
                    quoteItems={quoteItems}
                    clientName={clientName}
                    clientCompany={clientCompany}
                    clientPhone={clientPhone}
                    clientEmail={clientEmail}
                    clientRfc={clientRfc}
                    clientContactRole={clientContactRole}
                    projectType={projectType}
                    subtotal={subtotal}
                    tax={tax}
                    total={total}
                    includeIva={includeIva}
                    exchangeRate={exchangeRate}
                    projectScope={projectScope}
                    quoteNotes={quoteNotes}
                    showModels={showModelsInPdf}
                    currency={currency}
                    quoteNumber={quoteNumber}
                  />
                </div>
              </div>
              <div className="p-4 bg-white border-t flex flex-col sm:flex-row justify-end gap-3 shrink-0">
                <Button variant="outline" onClick={() => setShowPreview(false)} className="w-full sm:w-auto order-2 sm:order-1">Cerrar</Button>
                <Button onClick={() => { setShowPreview(false); printQuotePdf(350); }} className="w-full sm:w-auto order-1 sm:order-2 bg-blue-600 hover:bg-blue-700">
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


