import { Compass } from 'lucide-react'

export default function NotFoundPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 p-6">
      <div className="text-center">
        <Compass className="mx-auto h-10 w-10 text-muted-foreground" />
        <h1 className="mt-3 text-lg font-semibold">404 — Page not found</h1>
        <p className="mt-1 text-sm text-muted-foreground">The page you are looking for does not exist.</p>
        <a href="/" className="mt-4 inline-block text-sm font-medium text-primary underline-offset-4 hover:underline">
          Back to home
        </a>
      </div>
    </div>
  )
}
