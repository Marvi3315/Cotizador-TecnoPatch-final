// Catalogos SAT de uso comun para CFDI 4.0
export const REGIMENES = [
  ['601', 'General de Ley Personas Morales'],
  ['603', 'Personas Morales con Fines no Lucrativos'],
  ['605', 'Sueldos y Salarios e Ingresos Asimilados'],
  ['606', 'Arrendamiento'],
  ['607', 'Enajenacion o Adquisicion de Bienes'],
  ['608', 'Demas ingresos'],
  ['612', 'Personas Fisicas con Actividades Empresariales y Profesionales'],
  ['616', 'Sin obligaciones fiscales'],
  ['620', 'Sociedades Cooperativas de Produccion'],
  ['621', 'Incorporacion Fiscal'],
  ['622', 'Actividades Agricolas, Ganaderas, Silvicolas y Pesqueras'],
  ['623', 'Opcional para Grupos de Sociedades'],
  ['624', 'Coordinados'],
  ['625', 'Actividades Empresariales con ingresos por Plataformas Tecnologicas'],
  ['626', 'Regimen Simplificado de Confianza (RESICO)']
] as const;

export const USOS_CFDI = [
  ['G01', 'Adquisicion de mercancias'],
  ['G02', 'Devoluciones, descuentos o bonificaciones'],
  ['G03', 'Gastos en general'],
  ['I01', 'Construcciones'],
  ['I02', 'Mobiliario y equipo de oficina'],
  ['I04', 'Equipo de computo y accesorios'],
  ['I06', 'Comunicaciones telefonicas'],
  ['I07', 'Comunicaciones satelitales'],
  ['I08', 'Otra maquinaria y equipo'],
  ['S01', 'Sin efectos fiscales'],
  ['CP01', 'Pagos']
] as const;

export const FORMAS_PAGO = [
  ['01', 'Efectivo'],
  ['02', 'Cheque nominativo'],
  ['03', 'Transferencia electronica'],
  ['04', 'Tarjeta de credito'],
  ['28', 'Tarjeta de debito'],
  ['99', 'Por definir']
] as const;

export const METODOS_PAGO = [
  ['PUE', 'PUE - Pago en una sola exhibicion'],
  ['PPD', 'PPD - Pago en parcialidades o diferido']
] as const;

export const DOC_KINDS = [
  'Constancia de Situacion Fiscal',
  'Opinion de cumplimiento (32-D)',
  'Contrato / Orden de compra',
  'Cotizacion aceptada',
  'Acta constitutiva',
  'Poder del representante',
  'Identificacion del representante',
  'Comprobante de domicilio',
  'Caratula bancaria',
  'Alta de proveedor',
  'Otro'
] as const;

export const RFC_REGEX = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/;
