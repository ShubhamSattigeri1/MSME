'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function Home() {
  const router = useRouter()
  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('buyer_token') : null
    if (token) {
      router.replace('/orders')
    } else {
      router.replace('/login')
    }
  }, [])
  return null
}
