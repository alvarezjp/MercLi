import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Endpoint de prueba - Etapa 0
// Verifica que las credenciales de Supabase y el ticket de Mercado Público
// funcionan correctamente antes de seguir avanzando en el proyecto.
//
// Ubicación en el proyecto: app/api/test-connection/route.ts

export async function GET() {
  const resultados: Record<string, any> = {};

  // 1. Probar conexión a Supabase
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error(
        'Faltan NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY en .env.local'
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const { error } = await supabase.auth.getSession();

    if (error) throw error;

    resultados.supabase = {
      ok: true,
      mensaje: 'Conexión a Supabase exitosa (URL y anon key válidas).',
    };
  } catch (err: any) {
    resultados.supabase = {
      ok: false,
      mensaje: 'Error al conectar con Supabase.',
      error: err.message ?? String(err),
    };
  }

  // 2. Probar conexión a la API de Mercado Público
  try {
    const ticket = process.env.MERCADOPUBLICO_TICKET;

    if (!ticket) {
      throw new Error('Falta MERCADOPUBLICO_TICKET en .env.local');
    }

    const hoy = new Date();
    const dd = String(hoy.getDate()).padStart(2, '0');
    const mm = String(hoy.getMonth() + 1).padStart(2, '0');
    const yyyy = hoy.getFullYear();
    const fecha = `${dd}${mm}${yyyy}`;

    const url = `https://api.mercadopublico.cl/servicios/v1/publico/licitaciones.json?fecha=${fecha}&ticket=${ticket}`;

    const resp = await fetch(url);
    const data = await resp.json();

    if (!resp.ok) {
      throw new Error(`La API respondió con status ${resp.status}`);
    }

    resultados.mercadoPublico = {
      ok: true,
      mensaje: 'Conexión a la API de Mercado Público exitosa.',
      cantidadLicitacionesHoy: data?.Cantidad ?? data?.Listado?.length ?? 'no informado',
    };
  } catch (err: any) {
    resultados.mercadoPublico = {
      ok: false,
      mensaje: 'Error al conectar con la API de Mercado Público.',
      error: err.message ?? String(err),
    };
  }

  const todoOk = resultados.supabase.ok && resultados.mercadoPublico.ok;

  return NextResponse.json(
    {
      etapa: 'Etapa 0 - Verificación de conexiones',
      todoOk,
      resultados,
    },
    { status: todoOk ? 200 : 500 }
  );
}