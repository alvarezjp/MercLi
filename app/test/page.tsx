'use client';

import { useEffect, useState } from 'react';

// Página de prueba - Etapa 0
// Muestra visualmente si Supabase y la API de Mercado Público están bien conectados.
//
// Ubicación en el proyecto: app/test/page.tsx
// Una vez corriendo el proyecto (npm run dev), visita: http://localhost:3000/test

export default function TestConnectionPage() {
  const [data, setData] = useState<any>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    fetch('/api/test-connection')
      .then((res) => res.json())
      .then((json) => {
        setData(json);
        setCargando(false);
      })
      .catch((err) => {
        setData({ todoOk: false, error: err.message });
        setCargando(false);
      });
  }, []);

  if (cargando) {
    return <p style={{ padding: 24, fontFamily: 'monospace' }}>Probando conexiones...</p>;
  }

  return (
    <div style={{ padding: 24, fontFamily: 'monospace', maxWidth: 700 }}>
      <h1>{data.todoOk ? '✅ Todo conectado correctamente' : '⚠️ Hay errores de conexión'}</h1>
      <p>Revisa el detalle de cada servicio abajo:</p>
      <pre
        style={{
          background: '#111',
          color: '#0f0',
          padding: 16,
          borderRadius: 8,
          overflowX: 'auto',
        }}
      >
        {JSON.stringify(data.resultados ?? data, null, 2)}
      </pre>
    </div>
  );
}