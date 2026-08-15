'use client'

import { useRouter } from 'next/navigation'
import { createClient } from '@/utils/supabase/client'

// Ubicación en el proyecto: components/LogoutButton.tsx

export default function LogoutButton() {
  const router = useRouter()

  const handleLogout = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <button onClick={handleLogout} style={{ marginTop: 24 }}>
      Cerrar sesión
    </button>
  )
}