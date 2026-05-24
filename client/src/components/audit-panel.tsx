import { useEffect, useMemo, useState } from "react"

import { api } from "@/api"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { FieldError } from "@/components/ui/field"

export function AuditPanel() {
  const [events, setEvents] = useState<Array<Record<string, unknown>>>([])
  const [message, setMessage] = useState<string | null>(null)

  const logText = useMemo(
    () => events.map((event) => JSON.stringify(event)).join("\n"),
    [events],
  )

  async function load() {
    try {
      const data = await api<{ events: Array<Record<string, unknown>> }>("/api/admin/audit")
      setEvents(data.events)
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Audit load failed")
    }
  }

  useEffect(() => {
    void load()
  }, [])

  return (
    <Card>
      <CardHeader>
        <CardTitle>Audit log</CardTitle>
        <CardDescription>{events.length} latest event(s)</CardDescription>
      </CardHeader>
      <CardContent>
        <pre className="max-h-[620px] overflow-auto rounded-lg border bg-muted/40 p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap">
          {logText || "No audit events."}
        </pre>
        {message ? <FieldError className="mt-4">{message}</FieldError> : null}
      </CardContent>
    </Card>
  )
}
