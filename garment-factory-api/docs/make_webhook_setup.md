# Make.com Webhook Setup

## 1. Email Trigger

- Module: "Watch Emails" using Gmail or IMAP.
- Filter: subject contains "order" OR sender is in the approved buyers list.
- Extract: sender email and email body as plain text. Strip HTML before sending.
- Next module: HTTP POST to `/api/intake/order`.

Payload:

```json
{
  "source": "email",
  "raw_message": "{{body}}",
  "sender_id": "{{from_email}}"
}
```

## 2. WhatsApp Trigger

- Module: "Watch for New WhatsApp Messages" or Webhook trigger via Twilio or 360dialog.
- Extract: from number and message body.
- Next module: HTTP POST to `/api/intake/order`.

Payload:

```json
{
  "source": "whatsapp",
  "raw_message": "{{body}}",
  "sender_id": "{{from_number}}"
}
```

## 3. Error Handling

Add an error handler module after the HTTP POST step. If the HTTP status is not `200`, send an alert email to the factory owner with the source, sender ID, raw message, status code, and response body.
