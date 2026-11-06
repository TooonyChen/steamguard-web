import { cn } from "@/lib/utils"
import { BrandMark } from "@/components/app-nav"
import { Button } from "@/components/ui/button"
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
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
    <div className={cn("flex flex-col gap-8", className)} {...props}>
      <div className="flex flex-col items-start gap-4">
        <BrandMark className="size-12 rounded-[13px] [&_svg]:size-6" />
        <div>
          <h1 className="text-[28px] leading-[34px] tracking-tight">Sign in to SteamGuard</h1>
          <p className="mt-1.5 text-muted-foreground">Your self-hosted Steam Guard vault.</p>
        </div>
      </div>
      <form onSubmit={onSubmit}>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="username" className="text-muted-foreground">
              Username
            </FieldLabel>
            <Input
              id="username"
              autoComplete="username"
              autoCapitalize="none"
              value={username}
              onChange={(event) => onUsernameChange(event.target.value)}
              className="h-12 rounded-xl md:h-11"
              required
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="password" className="text-muted-foreground">
              Password
            </FieldLabel>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => onPasswordChange(event.target.value)}
              className="h-12 rounded-xl md:h-11"
              required
            />
          </Field>
          {error ? <FieldError>{error}</FieldError> : null}
          <Button type="submit" size="lg" disabled={busy} className="mt-2 h-13 w-full rounded-xl text-base md:h-11">
            {busy ? "Signing in" : "Sign in"}
          </Button>
        </FieldGroup>
      </form>
      <p className="text-[13px] text-subtle">
        Accounts are created by an admin. Ask them to reset your password if you are locked out.
      </p>
    </div>
  )
}
