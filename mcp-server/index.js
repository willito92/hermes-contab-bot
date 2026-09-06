#!/usr/bin/env node

/**
 * eContabilidad - MCP Server & CLI Tool
 * Integra el ERP Contable con Antigravity AI y Terminal de Comandos
 */

const { Client } = require('pg');
const readline = require('readline');

const DB_URL = process.env.DATABASE_URL || 'postgresql://postgres.fntligjzcgsqzjqrdabh:EContabilidad2026PassDb@aws-1-us-west-2.pooler.supabase.com:6543/postgres';

const DTE_TOKENS = {
  'hgyvcybrkgtxmyjpscng': process.env.SUPABASE_ACCESS_TOKEN || '', // IMPORTADORA BENITEZ
  'lezxtykjiiqkoyvdfzqa': process.env.ECO_SUPABASE_ACCESS_TOKEN || '', // ECO TRANSPORTES
};

async function getDbClient() {
  const client = new Client({
    connectionString: DB_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  return client;
}

// ==========================================
// SERVICIOS CORE
// ==========================================

async function listCompanies() {
  const client = await getDbClient();
  try {
    const res = await client.query('SELECT id, nit, nombre, nrc, "dteProjectRef", "dteDatabaseName" FROM public.companies ORDER BY nombre ASC;');
    return res.rows;
  } finally {
    await client.end();
  }
}

async function resolveCompany(client, identifier) {
  if (identifier) {
    const trimmed = String(identifier).trim();
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) {
      const res = await client.query('SELECT id, nombre, nit, "dteProjectRef", "dteDatabaseName" FROM public.companies WHERE id = $1::uuid LIMIT 1;', [trimmed]);
      if (res.rows[0]) return res.rows[0];
    }
    const res = await client.query(
      'SELECT id, nombre, nit, "dteProjectRef", "dteDatabaseName" FROM public.companies WHERE nombre ILIKE $1 OR nit ILIKE $1 LIMIT 1;',
      [`%${trimmed}%`]
    );
    if (res.rows[0]) return res.rows[0];
  }
  const withRecs = await client.query(`
    SELECT c.id, c.nombre, c.nit, c."dteProjectRef", c."dteDatabaseName", COUNT(r.id) as rec_count 
    FROM public.companies c 
    LEFT JOIN public.receivables r ON r."companyId"::text = c.id::text 
    GROUP BY c.id, c.nombre, c.nit, c."dteProjectRef", c."dteDatabaseName" 
    ORDER BY rec_count DESC, c.nombre ASC 
    LIMIT 1;
  `);
  return withRecs.rows[0] || null;
}

async function getCxcSummary(companyId) {
  const client = await getDbClient();
  try {
    const comp = await resolveCompany(client, companyId);
    if (!comp) return { error: 'No se encontró empresa registrada.' };
    const cid = comp.id;

    const res = await client.query('SELECT * FROM public.receivables WHERE "companyId" = $1 ORDER BY "fechaEmision" DESC;', [cid]);
    const receivables = res.rows;

    let totalCartera = 0;
    let totalCobrado = 0;
    let totalPendiente = 0;
    let totalVencido = 0;

    const antiguedad = {
      alDia: 0,
      mora30a60: 0,
      mora60a90: 0,
      moraMas90: 0,
    };

    const cleanName = (name) => {
      if (!name) return 'Cliente General';
      let n = name.replace(/\?/g, 'Ñ').replace(/\uFFFD/g, 'Ñ').trim();
      if (n.endsWith(', S.A DE C.VQ')) n = n.slice(0, -1);
      return n;
    };

    const debtorsMap = {};
    const now = new Date();

    for (const r of receivables) {
      const monto = parseFloat(r.montoTotal) || 0;
      const saldo = parseFloat(r.saldoPendiente) || 0;
      const cobrado = monto - saldo;

      totalCartera += monto;
      totalCobrado += cobrado;
      totalPendiente += saldo;

      if (saldo > 0) {
        const fechaVenc = new Date(r.fechaVencimiento);
        const diffDays = Math.floor((now.getTime() - fechaVenc.getTime()) / (1000 * 60 * 60 * 24));

        if (diffDays > 0) {
          totalVencido += saldo;
          if (diffDays <= 30) antiguedad.mora30a60 += saldo;
          else if (diffDays <= 60) antiguedad.mora60a90 += saldo;
          else antiguedad.moraMas90 += saldo;
        } else {
          antiguedad.alDia += saldo;
        }
      }

      const rawName = r.clienteNombre || 'Cliente General';
      const nit = (r.clienteNit || '').trim();
      const nrc = (r.clienteNrc || '').trim();
      const key = nit || cleanName(rawName).toUpperCase();

      if (!debtorsMap[key]) {
        debtorsMap[key] = {
          clienteNombre: cleanName(rawName),
          clienteNit: nit || null,
          clienteNrc: nrc || null,
          totalFacturado: 0,
          totalCobrado: 0,
          saldoPendiente: 0,
          facturasPendientes: 0,
          facturasTotal: 0,
          porcentajeDeuda: 0,
        };
      }

      debtorsMap[key].totalFacturado += monto;
      debtorsMap[key].totalCobrado += cobrado;
      debtorsMap[key].saldoPendiente += saldo;
      debtorsMap[key].facturasTotal += 1;
      if (saldo > 0) debtorsMap[key].facturasPendientes += 1;
    }

    const deudores = Object.values(debtorsMap)
      .filter(d => d.saldoPendiente > 0)
      .map(d => ({
        ...d,
        totalFacturado: Number(d.totalFacturado.toFixed(2)),
        totalCobrado: Number(d.totalCobrado.toFixed(2)),
        saldoPendiente: Number(d.saldoPendiente.toFixed(2)),
        porcentajeDeuda: totalPendiente > 0 ? Number(((d.saldoPendiente / totalPendiente) * 100).toFixed(1)) : 0,
      }))
      .sort((a, b) => b.saldoPendiente - a.saldoPendiente);

    return {
      companyId: cid,
      companyNombre: comp.nombre,
      totalFacturas: receivables.length,
      totalCartera: Number(totalCartera.toFixed(2)),
      totalCobrado: Number(totalCobrado.toFixed(2)),
      totalPendiente: Number(totalPendiente.toFixed(2)),
      totalVencido: Number(totalVencido.toFixed(2)),
      totalDeudores: deudores.length,
      antiguedad: {
        alDia: Number(antiguedad.alDia.toFixed(2)),
        mora30a60: Number(antiguedad.mora30a60.toFixed(2)),
        mora60a90: Number(antiguedad.mora60a90.toFixed(2)),
        moraMas90: Number(antiguedad.moraMas90.toFixed(2)),
      },
      deudores,
    };
  } finally {
    await client.end();
  }
}

async function listReceivables(companyId, estado = 'TODOS') {
  const client = await getDbClient();
  try {
    const comp = await resolveCompany(client, companyId);
    if (!comp) return [];
    const cid = comp.id;

    let sql = 'SELECT id, "numeroControl", "tipoDte", "fechaEmision", "fechaVencimiento", "clienteNombre", "montoTotal", "saldoPendiente", estado FROM public.receivables WHERE "companyId" = $1';
    const params = [cid];

    if (estado && estado !== 'TODOS') {
      sql += ' AND estado = $2';
      params.push(estado);
    }
    sql += ' ORDER BY "fechaEmision" DESC LIMIT 50;';

    const res = await client.query(sql, params);
    return res.rows;
  } finally {
    await client.end();
  }
}

async function registerPayment(receivableId, monto, metodoPago = 'TRANSFERENCIA', referencia = '', crearPartida = true) {
  const client = await getDbClient();
  try {
    await client.query('BEGIN');
    const recRes = await client.query('SELECT * FROM public.receivables WHERE id = $1 FOR UPDATE;', [receivableId]);
    if (recRes.rows.length === 0) {
      throw new Error(`Cuenta por cobrar ${receivableId} no encontrada`);
    }

    const rec = recRes.rows[0];
    const saldoActual = parseFloat(rec.saldoPendiente);
    const montoAbono = parseFloat(monto);

    if (montoAbono <= 0) throw new Error('El monto debe ser mayor a 0');
    if (montoAbono > saldoActual) throw new Error(`El monto ($${montoAbono}) supera el saldo pendiente ($${saldoActual})`);

    let partidaId = null;

    if (crearPartida) {
      // Buscar siguiente número de partida
      const maxNumRes = await client.query('SELECT COALESCE(MAX(numero), 0) + 1 as next_num FROM public.entries WHERE "companyId" = $1;', [rec.companyId]);
      const nextNum = maxNumRes.rows[0].next_num;

      const entryRes = await client.query(`
        INSERT INTO public.entries (id, "companyId", numero, fecha, tipo, concepto, "createdAt", "updatedAt")
        VALUES (gen_random_uuid(), $1, $2, CURRENT_DATE, 'INGRESO', $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        RETURNING id;
      `, [rec.companyId, nextNum, `Cobro DTE ${rec.numeroControl} - ${rec.clienteNombre}`]);

      partidaId = entryRes.rows[0].id;

      // Movimientos: Banco (Debe) y Clientes (Haber)
      await client.query(`
        INSERT INTO public.movements (id, "entryId", "cuentaCodigo", debe, haber, concepto)
        VALUES 
          (gen_random_uuid(), $1, '110201', $2, 0, $3),
          (gen_random_uuid(), $1, '110301', 0, $2, $4);
      `, [partidaId, montoAbono, `Ingreso cobro DTE ${rec.numeroControl} (${metodoPago})`, `Abono factura ${rec.numeroControl}`]);
    }

    const nuevoSaldo = Number((saldoActual - montoAbono).toFixed(2));
    const nuevoEstado = nuevoSaldo <= 0 ? 'COBRADO' : 'PARCIAL';

    await client.query(`
      UPDATE public.receivables 
      SET "saldoPendiente" = $1, estado = $2, "updatedAt" = CURRENT_TIMESTAMP
      WHERE id = $3;
    `, [nuevoSaldo, nuevoEstado, receivableId]);

    const payRes = await client.query(`
      INSERT INTO public.receivable_payments (id, "receivableId", fecha, monto, "metodoPago", referencia, "partidaId", "createdAt")
      VALUES (gen_random_uuid(), $1, CURRENT_DATE, $2, $3, $4, $5, CURRENT_TIMESTAMP)
      RETURNING *;
    `, [receivableId, montoAbono, metodoPago, referencia, partidaId]);

    await client.query('COMMIT');

    return {
      success: true,
      abono: payRes.rows[0],
      nuevoSaldo,
      nuevoEstado,
      partidaId,
      documento: rec.numeroControl,
      cliente: rec.clienteNombre,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

async function listInventory(companyId) {
  const client = await getDbClient();
  try {
    let cid = companyId;
    if (!cid) {
      const compRes = await client.query('SELECT id FROM public.companies LIMIT 1;');
      cid = compRes.rows[0]?.id;
    }

    const res = await client.query('SELECT id, codigo, nombre, "unidadMedida", "precioVenta", "costoPromedio", "stockActual" FROM public.products WHERE "companyId" = $1 ORDER BY codigo ASC;', [cid]);
    return res.rows;
  } finally {
    await client.end();
  }
}

async function syncFromDte(companyId) {
  const client = await getDbClient();
  try {
    const comp = await resolveCompany(client, companyId);
    if (!comp) {
      return { error: 'No se encontró empresa registrada para sincronizar.' };
    }
    const cid = comp.id;
    const dteProjectRef = comp.dteProjectRef || 'hgyvcybrkgtxmyjpscng';
    const token = process.env.SUPABASE_ACCESS_TOKEN || DTE_TOKENS[dteProjectRef] || '';

    if (!token) {
      return { error: 'No se encontró SUPABASE_ACCESS_TOKEN configurado para acceder a DTE Fácil.' };
    }

    const sql = `
      SELECT id, codigo_generacion, numero_control, dte_type, fecha_emision, monto_total, nombre_cliente, full_dte, estado
      FROM historial_dtes
      WHERE estado IN ('RECIBIDO', 'Transmitido') AND dte_type IN ('01', '03', 'Factura', 'Crédito Fiscal')
      ORDER BY fecha_emision ASC;
    `;

    const response = await fetch(`https://api.supabase.com/v1/projects/${dteProjectRef}/database/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0',
      },
      body: JSON.stringify({ query: sql }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return { error: `Error al conectar a DTE Fácil SV (HTTP ${response.status}): ${errText}` };
    }

    const dtes = await response.json();
    let nuevos = 0;
    let actualizados = 0;
    let itemsProcesados = 0;
    const nuevosDocumentos = [];

    for (const dte of dtes) {
      const numeroControl = dte.numero_control;
      const montoTotal = parseFloat(dte.monto_total || '0');
      const fechaEmision = dte.fecha_emision ? new Date(dte.fecha_emision).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];

      const fullDte = dte.full_dte || {};
      const receptor = fullDte.receptor || {};
      const clienteNombre = (dte.nombre_cliente || receptor.nombre || 'Cliente General').trim();

      // Excluir William Ordoñez por instrucción expresa
      if (clienteNombre.toUpperCase().includes('WILLIAM ALEXANDER ORDO') || clienteNombre.toUpperCase().includes('WILLIAM ORDO')) {
        continue;
      }

      const emisionDate = new Date(fechaEmision);
      const vencimientoDate = new Date(emisionDate.getTime() + 30 * 24 * 60 * 60 * 1000);
      const fechaVencimiento = vencimientoDate.toISOString().split('T')[0];

      const checkRes = await client.query(
        'SELECT id FROM public.receivables WHERE "companyId"::text = $1 AND "numeroControl" = $2 LIMIT 1;',
        [String(cid), numeroControl]
      );

      const cuerpo = fullDte.cuerpoDocumento || [];
      const resumen = fullDte.resumen || {};
      const clienteNit = receptor.nit || receptor.numDocumento || null;
      const clienteNrc = receptor.nrc || null;
      const condicionOperacion = String(resumen.condicionOperacion || '1');

      if (checkRes.rows.length === 0) {
        await client.query(`
          INSERT INTO public.receivables (
            id, "companyId", "codigoGeneracion", "numeroControl", "tipoDte",
            "fechaEmision", "fechaVencimiento", "clienteNombre", "clienteNit", "clienteNrc",
            "montoTotal", "saldoPendiente", estado, "diasCredito", "condicionOperacion", items,
            "createdAt", "updatedAt"
          ) VALUES (
            gen_random_uuid(), $1, $2, $3, $4,
            $5, $6, $7, $8, $9,
            $10, $11, 'PENDIENTE', 30, $12, $13,
            CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
          );
        `, [
          String(cid), dte.codigo_generacion, numeroControl, dte.dte_type,
          fechaEmision, fechaVencimiento, clienteNombre, clienteNit, clienteNrc,
          montoTotal, montoTotal, condicionOperacion, JSON.stringify(cuerpo)
        ]);

        nuevos++;
        nuevosDocumentos.push({
          numeroControl,
          cliente: clienteNombre,
          monto: montoTotal,
          fecha: fechaEmision
        });
      } else {
        actualizados++;
      }

      // Procesar catálogo de productos
      if (Array.isArray(cuerpo)) {
        for (const it of cuerpo) {
          const sku = (it.codigo || it.sku || '').trim();
          const nombre = (it.descripcion || it.nombre || '').trim();
          const precioVenta = parseFloat(it.precioUni || it.precioUnitario || '0');

          if (sku && nombre) {
            itemsProcesados++;
            const prodRes = await client.query('SELECT id FROM public.products WHERE "companyId"::text = $1 AND codigo = $2 LIMIT 1;', [String(cid), sku]);
            if (prodRes.rows.length > 0) {
              await client.query('UPDATE public.products SET "precioVenta" = $1 WHERE id = $2;', [precioVenta, prodRes.rows[0].id]);
            } else {
              await client.query(`
                INSERT INTO public.products (id, "companyId", codigo, nombre, "unidadMedida", "precioVenta", "stockActual", "costoPromedio", "createdAt")
                VALUES (gen_random_uuid(), $1::uuid, $2, $3, 'UNIDAD', $4, 0, 0, CURRENT_TIMESTAMP);
              `, [String(cid), sku, nombre, precioVenta]);
            }
          }
        }
      }
    }

    return {
      success: true,
      empresa: comp.nombre,
      totalDtesEnDteFacil: dtes.length,
      nuevosDtesSincronizados: nuevos,
      dtesPreviamenteExistentes: actualizados,
      totalCuentasPorCobrar: actualizados + nuevos,
      itemsProcesados,
      ultimosNuevos: nuevosDocumentos.slice(-5),
      mensaje: nuevos > 0
        ? `Se descargaron y sincronizaron ${nuevos} nuevas facturas/DTEs exitosamente desde DTE Fácil SV.`
        : `Todas las facturas ya están al día en el sistema (${actualizados} DTEs registrados). No hay nuevos documentos pendientes.`
    };
  } finally {
    await client.end();
  }
}

// ==========================================
// MODO SERVIDOR MCP (JSON-RPC 2.0 por Stdio)
// ==========================================

const MCP_TOOLS = [
  {
    name: 'econtab_sync_dte',
    description: 'Sincroniza y descarga las nuevas ventas y facturas electrónicas (DTEs) desde el sistema de facturación DTE Fácil SV hacia eContabilidad, actualizando cuentas por cobrar e inventario.',
    inputSchema: {
      type: 'object',
      properties: {
        companyId: { type: 'string', description: 'ID o nombre de la empresa (opcional, por defecto toma la empresa activa)' }
      }
    }
  },
  {
    name: 'econtab_list_companies',
    description: 'Lista todas las empresas o contribuyentes registrados en el sistema contable con sus fuentes DTE.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'econtab_cxc_summary',
    description: 'Obtiene el resumen financiero de Cuentas por Cobrar (total facturado, cobrado, saldo pendiente, cartera en mora y antigüedad de saldos).',
    inputSchema: {
      type: 'object',
      properties: {
        companyId: { type: 'string', description: 'ID de la empresa (opcional, por defecto toma la primera)' }
      }
    }
  },
  {
    name: 'econtab_cxc_list',
    description: 'Lista las facturas por cobrar con saldo pendiente, cliente, fecha de emisión y vencimiento.',
    inputSchema: {
      type: 'object',
      properties: {
        companyId: { type: 'string', description: 'ID de la empresa' },
        estado: { type: 'string', enum: ['TODOS', 'PENDIENTE', 'PARCIAL', 'COBRADO'], description: 'Filtrar por estado' }
      }
    }
  },
  {
    name: 'econtab_cxc_register_payment',
    description: 'Registra un abono o pago a una cuenta por cobrar, rebaja el saldo y genera opcionalmente la partida contable automática.',
    inputSchema: {
      type: 'object',
      required: ['receivableId', 'monto'],
      properties: {
        receivableId: { type: 'string', description: 'ID de la cuenta por cobrar (receivable)' },
        monto: { type: 'number', description: 'Monto a abonar en dólares' },
        metodoPago: { type: 'string', enum: ['TRANSFERENCIA', 'CHEQUE', 'DEPOSITO', 'EFECTIVO'], default: 'TRANSFERENCIA' },
        referencia: { type: 'string', description: 'No. de comprobante bancario o referencia de pago' },
        crearPartida: { type: 'boolean', default: true, description: 'Si es true, crea la partida contable automática (Banco vs Clientes)' }
      }
    }
  },
  {
    name: 'econtab_inventory_stock',
    description: 'Consulta el catálogo de inventario con existencias actuales, precios y costos.',
    inputSchema: {
      type: 'object',
      properties: {
        companyId: { type: 'string', description: 'ID de la empresa' }
      }
    }
  }
];

function runMcpServer() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
  });

  const send = (obj) => {
    process.stdout.write(JSON.stringify(obj) + '\n');
  };

  rl.on('line', async (line) => {
    if (!line.trim()) return;
    let req;
    try {
      req = JSON.parse(line);
    } catch (e) {
      return send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    }

    const { id, method, params } = req;

    try {
      if (method === 'initialize') {
        return send({
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2024-11-05',
            serverInfo: { name: 'econtab-mcp-server', version: '1.0.0' },
            capabilities: { tools: {} }
          }
        });
      }

      if (method === 'notifications/initialized') {
        return; // Sin respuesta para notificaciones
      }

      if (method === 'tools/list') {
        return send({
          jsonrpc: '2.0',
          id,
          result: { tools: MCP_TOOLS }
        });
      }

      if (method === 'tools/call') {
        const { name, arguments: args = {} } = params || {};
        let data;

        if (name === 'econtab_list_companies') {
          data = await listCompanies();
        } else if (name === 'econtab_sync_dte') {
          data = await syncFromDte(args.companyId);
        } else if (name === 'econtab_cxc_summary') {
          data = await getCxcSummary(args.companyId);
        } else if (name === 'econtab_cxc_list') {
          data = await listReceivables(args.companyId, args.estado);
        } else if (name === 'econtab_cxc_register_payment') {
          data = await registerPayment(args.receivableId, args.monto, args.metodoPago, args.referencia, args.crearPartida !== false);
        } else if (name === 'econtab_inventory_stock') {
          data = await listInventory(args.companyId);
        } else {
          return send({
            jsonrpc: '2.0',
            id,
            error: { code: -32601, message: `Herramienta desconocida: ${name}` }
          });
        }

        return send({
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: JSON.stringify(data, null, 2) }]
          }
        });
      }

      return send({
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Método desconocido: ${method}` }
      });
    } catch (err) {
      return send({
        jsonrpc: '2.0',
        id,
        error: { code: -32000, message: err.message }
      });
    }
  });
}

// ==========================================
// MODO CLI DE TERMINAL
// ==========================================

async function runCli() {
  const args = process.argv.slice(2);
  const cmd = args[0] || 'help';

  console.log('\n💼 === ERP CONTABLE CLI & MCP ===\n');

  if (cmd === 'companies') {
    const companies = await listCompanies();
    console.table(companies.map(c => ({
      ID: c.id,
      NIT: c.nit,
      Nombre: c.nombre,
      Fuente_DTE: c.dteDatabaseName || 'Ninguna'
    })));
  } else if (cmd === 'cxc:summary') {
    const companyId = args[1];
    const summary = await getCxcSummary(companyId);
    console.log('📊 RESUMEN DE CARTERA (CUENTAS POR COBRAR):');
    console.log(`- Total Facturado:   $${summary.totalCartera.toLocaleString('en-US', { minimumFractionDigits: 2 })} (${summary.totalFacturas} facturas)`);
    console.log(`- Saldo Pendiente:   $${summary.totalPendiente.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    console.log(`- Total Recuperado:  $${summary.totalCobrado.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    console.log(`- Cartera Vencida:   $${summary.totalVencido.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    console.log('\n📅 ANTIGÜEDAD DE SALDOS:');
    console.log(`- Al Día (0-30 días):  $${summary.antiguedad.alDia.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    console.log(`- Mora 31-60 días:     $${summary.antiguedad.mora30a60.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    console.log(`- Mora 61-90 días:     $${summary.antiguedad.mora60a90.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    console.log(`- Mora +90 días:       $${summary.antiguedad.moraMas90.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  } else if (cmd === 'cxc:list') {
    const estado = args[1] || 'PENDIENTE';
    const list = await listReceivables(null, estado);
    console.table(list.map(r => ({
      Control: r.numeroControl,
      Tipo: r.tipoDte,
      Cliente: r.clienteNombre.substring(0, 30),
      Emision: r.fechaEmision.substring(0, 10),
      Vence: r.fechaVencimiento.substring(0, 10),
      Total: `$${parseFloat(r.montoTotal).toFixed(2)}`,
      Saldo: `$${parseFloat(r.saldoPendiente).toFixed(2)}`,
      Estado: r.estado
    })));
  } else if (cmd === 'inventory' || cmd === 'stock') {
    const companyId = args[1];
    const inv = await listInventory(companyId);
    console.table(inv.map(p => ({
      Codigo: p.codigo,
      Nombre: p.nombre.substring(0, 35),
      Unidad: p.unidadMedida,
      Precio_Venta: `$${parseFloat(p.precioVenta).toFixed(2)}`,
      Stock: parseFloat(p.stockActual)
    })));
  } else if (cmd === 'sync') {
    const companyId = args[1];
    const res = await syncFromDte(companyId);
    console.log(JSON.stringify(res, null, 2));
  } else {
    console.log('Comandos disponibles:');
    console.log('  node index.js companies               Lista las empresas registradas');
    console.log('  node index.js sync [id]               Sincroniza ventas y DTEs desde DTE Fácil SV');
    console.log('  node index.js cxc:summary [id]        Resumen de cartera y morosidad');
    console.log('  node index.js cxc:list [PENDIENTE]    Lista de facturas por cobrar');
    console.log('  node index.js inventory               Lista productos y existencias');
    console.log('  node index.js --mcp                   Inicia como servidor MCP para IA');
  }

  process.exit(0);
}

// Punto de entrada
if (process.argv.includes('--mcp')) {
  runMcpServer();
} else {
  runCli().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });
}
