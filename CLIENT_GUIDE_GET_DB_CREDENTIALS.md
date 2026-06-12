# Guide for Client: Get Correct Supabase Connection String

## Quick Steps to Get the Connection String

Your Supabase project: **kkaadonjqhhgupwnrhzc**

### Option 1: Copy Existing Connection String (Fastest)

1. Go to: https://app.supabase.com
2. Sign in with your account
3. Select project: **kkaadonjqhhgupwnrhzc**
4. Click **Settings** (gear icon) → **Database**
5. Scroll to **"Connection Pooling"** section
6. Make sure **"Pooler mode"** is set to **"Transaction"** or **"Session"**
7. Under **Connection String**, you'll see:
   ```
   postgresql://postgres.<project-ref>:<PASSWORD>@<region>.pooler.supabase.com:5432/postgres
   ```
8. **Copy the entire string** (click the copy icon)
9. Send it to the developer

### Option 2: If Password Was Reset Recently

1. Go to: https://app.supabase.com → Your Project
2. Click **Settings** → **Database**
3. Look for **"Database Password"** section
4. If you reset it recently, copy the new password
5. The connection string format is:
   ```
   postgresql://postgres.kkaadonjqhhgupwnrhzc:<YOUR_NEW_PASSWORD>@aws-1-us-east-1.pooler.supabase.com:5432/postgres
   ```

### Option 3: If You Lost the Password

1. Go to **Settings** → **Database**
2. Click **"Reset database password"**
3. Copy the new password from the popup
4. Use it to construct: `postgresql://postgres.kkaadonjqhhgupwnrhzc:<NEW_PASSWORD>@aws-1-us-east-1.pooler.supabase.com:5432/postgres`

---

## What to Share with Developer

Send the **full connection string** that looks like this:

```
postgresql://postgres.kkaadonjqhhgupwnrhzc:XXXXXXXXXXXXX@aws-1-us-east-1.pooler.supabase.com:5432/postgres
```

⚠️ Make sure it's from the **Connection Pooling** section (not "Direct connection")

---

## Common Issues

**"I see the old password"** → The old password `VirtualAI&Booking.com%2333` is expired. Reset it in Settings → Database → Reset database password

**"Connection Pooling is not visible"** → Make sure you're on the right project (kkaadonjqhhgupwnrhzc) and scroll down in the Database settings

**"I don't have access"** → Ask the project owner to share the connection string with you
