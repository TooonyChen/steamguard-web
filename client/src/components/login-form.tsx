import { ShieldCheckIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"

export function LoginForm({
  username,
  password,
  error,
  busy,
  onUsernameChange,
  onPasswordChange,
  onSubmit,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  username: string
  password: string
  error: string | null
  busy: boolean
  onUsernameChange: (value: string) => void
  onPasswordChange: (value: string) => void
  onSubmit: (event: React.FormEvent) => void
}) {
  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card className="border-foreground/10 bg-card/95 shadow-xl shadow-foreground/5">
        <CardHeader>
          <div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <ShieldCheckIcon className="size-5" />
          </div>
          <CardTitle>SteamGuard Web</CardTitle>
          <CardDescription>
            Sign in to manage Steam Guard codes and mobile confirmations.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="username">Username</FieldLabel>
                <Input
                  id="username"
                  autoComplete="username"
                  value={username}
                  onChange={(event) => onUsernameChange(event.target.value)}
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="password">Password</FieldLabel>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => onPasswordChange(event.target.value)}
                  required
                />
              </Field>
              {error ? <FieldError>{error}</FieldError> : null}
              <Field>
                <Button type="submit" disabled={busy} className="w-full">
                  {busy ? "Signing in" : "Sign in"}
                </Button>
                <FieldDescription className="text-center">
                  Access is created by an administrator. There is no public registration.
                </FieldDescription>
              </Field>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
