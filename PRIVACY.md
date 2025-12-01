# Privacy Policy

**Docmile - Document Engineering Assistant**

*Last updated: November 30, 2024*

---

## 1. Introduction

Docmile ("we", "our", or "the Service") is a Google Docs Add-on that helps users edit and improve their documents using artificial intelligence. This Privacy Policy explains how we handle your information when you use our Service.

**Our Core Principle:** We process your text to provide AI-powered editing, but we do not permanently store your document content.

---

## 2. Information We Process

### 2.1 Document Content (Temporary Processing Only)

When you use Docmile, we temporarily process:
- The text content of your Google Document (or selected portions)
- Your editing instructions and preferences

**Important:** This content is:
- Sent to our AI processing servers only when you actively request an edit
- Processed in real-time to generate suggestions
- **NOT permanently stored** on our servers
- **NOT used to train AI models**

### 2.2 Account Information

We collect and store:
- A hashed version of your license key (for authentication)
- Usage credits and consumption history
- Custom "receipts" (saved editing macros) you create

### 2.3 Technical Data

We automatically collect:
- Document ID (to provide per-document features like edit history)
- Timestamps of operations
- Error logs (for debugging purposes only)

---

## 3. How We Use Your Information

| Purpose | Data Used | Retention |
|---------|-----------|-----------|
| Process your editing requests | Document text, instructions | Transient (not stored) |
| Authenticate your license | License key hash | Duration of subscription |
| Track usage credits | Operation metadata | Duration of subscription |
| Provide edit history & undo | Edit events, text diffs | 30 days |
| Improve service reliability | Anonymized error logs | 90 days |

---

## 4. Third-Party Services

Docmile uses the following third-party services to operate:

| Service | Purpose | Their Privacy Policy |
|---------|---------|---------------------|
| **Google Gemini AI** | AI text processing | [Google AI Privacy](https://ai.google.dev/terms) |
| **Cloudflare Workers** | API hosting & processing | [Cloudflare Privacy](https://www.cloudflare.com/privacypolicy/) |
| **Supabase** | License & usage database | [Supabase Privacy](https://supabase.com/privacy) |

**Note:** When your text is sent to Google Gemini for processing, it is subject to Google's AI terms. According to Google's policy, data sent via their API is not used to train their models.

---

## 5. Data Security

We implement industry-standard security measures:

- All data transmission is encrypted using HTTPS/TLS
- License keys are stored as irreversible SHA-256 hashes
- Database access is protected by Row Level Security (RLS)
- No plain-text passwords are ever stored

---

## 6. Your Rights

You have the right to:

| Right | How to Exercise |
|-------|-----------------|
| **Access** your data | Contact us at the email below |
| **Delete** your data | Request deletion; we will remove all stored data within 30 days |
| **Export** your data | Request a copy of your stored preferences and history |
| **Revoke** access | Remove the Add-on from Google Docs at any time |

---

## 7. Data Retention

| Data Type | Retention Period |
|-----------|------------------|
| Document content | Not retained (processed transiently) |
| License information | Until subscription ends + 30 days |
| Edit history events | 30 days from creation |
| Usage logs | 90 days |

---

## 8. Children's Privacy

Docmile is not intended for use by children under 13 years of age. We do not knowingly collect information from children under 13.

---

## 9. International Data Transfers

Our servers are located in the European Union (EU). If you access the Service from outside the EU, your data will be transferred to and processed in the EU.

---

## 10. Changes to This Policy

We may update this Privacy Policy from time to time. We will notify users of significant changes by:
- Updating the "Last updated" date at the top
- Displaying a notice within the Add-on

---

## 11. Contact Us

For any privacy-related questions or requests:

- **Email:** [YOUR_EMAIL]
- **Website:** [YOUR_WEBSITE]

---

## 12. Google API Services User Data Policy

Docmile's use and transfer of information received from Google APIs adheres to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements.

Specifically:
- We only request access to the current document (`documents.currentonly` scope)
- We do not transfer your Google data to third parties except as necessary to provide the Service
- We do not use your Google data for advertising purposes

---

*This Privacy Policy is effective as of the date stated above.*
