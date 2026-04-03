import type { PoolClient, QueryResultRow } from "pg";
import { withDbTransaction } from "../db/client.ts";
import { recalculateEmailDomainReputation } from "./emailDeliverabilityService.ts";
import { recordGrowthProviderFeedbackEvent } from "../growth/growthAutomationService.ts";

type ProviderEventType = "delivered" | "bounce_soft" | "bounce_hard" | "complaint" | "reject";

interface SnsEnvelope {
  Type?: string;
  TopicArn?: string;
  Message?: string | Record<string, unknown>;
  SubscribeURL?: string;
}

interface SesMailPayload {
  messageId?: string;
  source?: string;
  destination?: string[];
  tags?: Record<string, string[]>;
}

interface SesDeliveryPayload {
  timestamp?: string;
  recipients?: string[];
}

interface SesBounceRecipientPayload {
  emailAddress?: string;
}

interface SesBouncePayload {
  timestamp?: string;
  bounceType?: string;
  bounceSubType?: string;
  bouncedRecipients?: SesBounceRecipientPayload[];
}

interface SesComplaintRecipientPayload {
  emailAddress?: string;
}

interface SesComplaintPayload {
  timestamp?: string;
  complaintSubType?: string;
  complainedRecipients?: SesComplaintRecipientPayload[];
}

interface SesNotificationPayload {
  eventType?: string;
  mail?: SesMailPayload;
  delivery?: SesDeliveryPayload;
  bounce?: SesBouncePayload;
  complaint?: SesComplaintPayload;
}

interface EmailRecipientLookupRow extends QueryResultRow {
  campaign_recipient_id: string;
  contact_id: string;
  business_id: string;
  recipient_email: string;
  domain_name: string | null;
}

interface InsertedEventRow extends QueryResultRow {
  id: string;
}

interface ResolvedEventContext {
  campaignRecipientId?: string;
  contactId?: string;
  businessId: string;
  domainName: string;
  recipientEmail?: string;
}

interface NormalizedProviderEvent {
  eventType: ProviderEventType;
  subtype?: string;
  occurredAt: string;
  providerMessageId: string;
  recipientEmail: string;
  rawPayloadJson: string;
  context: ResolvedEventContext;
}

export interface SesWebhookProcessResult {
  notificationType: string;
  processedEvents: number;
  skippedEvents: number;
  subscriptionConfirmed: boolean;
}

function isNonEmptyString(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseObject(value: unknown): Record<string, unknown> {
  if (!value) {
    return {};
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }

  return typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function getStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function normalizeTopicAllowlist(): string[] {
  return (process.env.SES_SNS_TOPIC_ARNS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function shouldAutoConfirmSubscriptions(): boolean {
  return (process.env.SES_SNS_AUTO_CONFIRM?.trim() ?? "true").toLowerCase() !== "false";
}

function extractDomainFromEmail(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const [, domain] = value.trim().toLowerCase().split("@");
  return domain?.trim() || null;
}

function normalizeTagValue(tags: Record<string, string[]> | undefined, key: string): string | undefined {
  return getString(tags?.[key]?.[0]);
}

async function executeQuery<TRow extends QueryResultRow>(
  client: PoolClient,
  text: string,
  values: unknown[],
): Promise<{ rows: TRow[] }> {
  return client.query<TRow>(text, values);
}

async function confirmSnsSubscription(subscribeUrl: string | undefined): Promise<boolean> {
  if (!subscribeUrl || !shouldAutoConfirmSubscriptions()) {
    return false;
  }

  await fetch(subscribeUrl, {
    method: "GET",
  });

  return true;
}

async function resolveEventContext(
  client: PoolClient,
  input: {
    providerMessageId: string;
    fallbackBusinessId?: string;
    fallbackDomainName?: string | null;
    recipientIdTag?: string;
  },
): Promise<ResolvedEventContext | null> {
  const lookupByRecipientId = input.recipientIdTag
    ? await executeQuery<EmailRecipientLookupRow>(
        client,
        `
          select
            r.id as campaign_recipient_id,
            r.contact_id,
            c.business_id,
            co.email as recipient_email,
            s.domain_name
          from email_campaign_recipients r
          inner join email_campaigns c on c.id = r.campaign_id
          inner join email_contacts co on co.id = r.contact_id
          left join business_email_settings s on s.business_id = c.business_id
          where r.id = $1::uuid
          limit 1
        `,
        [input.recipientIdTag],
      )
    : { rows: [] };

  const matchedByRecipientId = lookupByRecipientId.rows[0];

  if (matchedByRecipientId) {
    const resolvedDomainName = matchedByRecipientId.domain_name ?? input.fallbackDomainName;

    if (!resolvedDomainName) {
      return null;
    }

    return {
      campaignRecipientId: matchedByRecipientId.campaign_recipient_id,
      contactId: matchedByRecipientId.contact_id,
      businessId: matchedByRecipientId.business_id,
      domainName: resolvedDomainName,
      recipientEmail: matchedByRecipientId.recipient_email,
    };
  }

  const lookupByMessageId = await executeQuery<EmailRecipientLookupRow>(
    client,
    `
      select
        r.id as campaign_recipient_id,
        r.contact_id,
        c.business_id,
        co.email as recipient_email,
        s.domain_name
      from email_campaign_recipients r
      inner join email_campaigns c on c.id = r.campaign_id
      inner join email_contacts co on co.id = r.contact_id
      left join business_email_settings s on s.business_id = c.business_id
      where r.ses_message_id = $1
      limit 1
    `,
    [input.providerMessageId],
  );

  const matchedByMessageId = lookupByMessageId.rows[0];

  if (matchedByMessageId) {
    const resolvedDomainName = matchedByMessageId.domain_name ?? input.fallbackDomainName;

    if (!resolvedDomainName) {
      return null;
    }

    return {
      campaignRecipientId: matchedByMessageId.campaign_recipient_id,
      contactId: matchedByMessageId.contact_id,
      businessId: matchedByMessageId.business_id,
      domainName: resolvedDomainName,
      recipientEmail: matchedByMessageId.recipient_email,
    };
  }

  if (!input.fallbackBusinessId || !input.fallbackDomainName) {
    return null;
  }

  return {
    businessId: input.fallbackBusinessId,
    domainName: input.fallbackDomainName,
  };
}

function normalizeProviderEvents(
  notification: SesNotificationPayload,
  context: ResolvedEventContext,
): NormalizedProviderEvent[] {
  const eventType = getString(notification.eventType)?.toLowerCase();
  const providerMessageId = getString(notification.mail?.messageId);

  if (!eventType || !providerMessageId) {
    return [];
  }

  const rawPayloadJson = JSON.stringify(notification);

  if (eventType === "delivery") {
    const occurredAt = getString(notification.delivery?.timestamp) ?? new Date().toISOString();
    const recipients = notification.delivery?.recipients?.length
      ? getStringArray(notification.delivery.recipients)
      : getStringArray(notification.mail?.destination);

    return recipients.map((recipientEmail) => ({
      eventType: "delivered",
      occurredAt,
      providerMessageId,
      recipientEmail,
      rawPayloadJson,
      context,
    }));
  }

  if (eventType === "bounce") {
    const occurredAt = getString(notification.bounce?.timestamp) ?? new Date().toISOString();
    const subtype = getString(notification.bounce?.bounceSubType);
    const normalizedEventType: ProviderEventType =
      getString(notification.bounce?.bounceType)?.toLowerCase() === "permanent"
        ? "bounce_hard"
        : "bounce_soft";

    return (notification.bounce?.bouncedRecipients ?? [])
      .map((recipient) => getString(recipient.emailAddress))
      .filter(isNonEmptyString)
      .map((recipientEmail) => ({
        eventType: normalizedEventType,
        subtype,
        occurredAt,
        providerMessageId,
        recipientEmail,
        rawPayloadJson,
        context,
      }));
  }

  if (eventType === "complaint") {
    const occurredAt = getString(notification.complaint?.timestamp) ?? new Date().toISOString();
    const subtype = getString(notification.complaint?.complaintSubType);
    const recipients = notification.complaint?.complainedRecipients?.length
      ? notification.complaint.complainedRecipients
      : (notification.mail?.destination ?? []).map((emailAddress) => ({ emailAddress }));

    return recipients
      .map((recipient) => getString(recipient.emailAddress))
      .filter(isNonEmptyString)
      .map((recipientEmail) => ({
        eventType: "complaint",
        subtype,
        occurredAt,
        providerMessageId,
        recipientEmail,
        rawPayloadJson,
        context,
      }));
  }

  if (eventType === "reject") {
    const occurredAt = new Date().toISOString();
    return getStringArray(notification.mail?.destination).map((recipientEmail) => ({
      eventType: "reject",
      occurredAt,
      providerMessageId,
      recipientEmail,
      rawPayloadJson,
      context,
    }));
  }

  return [];
}

async function insertProviderEvent(
  client: PoolClient,
  event: NormalizedProviderEvent,
): Promise<boolean> {
  const result = await executeQuery<InsertedEventRow>(
    client,
    `
      insert into email_provider_events (
        business_id,
        domain_name,
        campaign_recipient_id,
        provider_message_id,
        event_type,
        subtype,
        recipient_email,
        raw_payload_json,
        occurred_at
      ) values (
        $1::uuid,
        $2,
        $3::uuid,
        $4,
        $5,
        $6,
        $7,
        $8::jsonb,
        $9::timestamptz
      )
      on conflict do nothing
      returning id
    `,
    [
      event.context.businessId,
      event.context.domainName,
      event.context.campaignRecipientId ?? null,
      event.providerMessageId,
      event.eventType,
      event.subtype ?? null,
      event.recipientEmail,
      event.rawPayloadJson,
      event.occurredAt,
    ],
  );

  return Boolean(result.rows[0]?.id);
}

async function insertEmailEvent(
  client: PoolClient,
  input: {
    campaignRecipientId: string;
    providerMessageId: string;
    eventType: "delivered" | "bounce" | "complaint" | "failed";
    payloadJson: string;
    occurredAt: string;
  },
): Promise<void> {
  await executeQuery(
    client,
    `
      insert into email_events (
        campaign_recipient_id,
        send_id,
        event_type,
        provider_message_id,
        payload_json,
        occurred_at
      ) values (
        $1::uuid,
        (
          select send_id
          from email_campaign_recipients
          where id = $1::uuid
        ),
        $2,
        $3,
        $4::jsonb,
        $5::timestamptz
      )
    `,
    [
      input.campaignRecipientId,
      input.eventType,
      input.providerMessageId,
      input.payloadJson,
      input.occurredAt,
    ],
  );
}

async function syncCampaignSendTrackingState(
  client: PoolClient,
  campaignRecipientId: string,
): Promise<void> {
  const contextResult = await executeQuery<{ send_id: string | null; campaign_id: string }>(
    client,
    `
      select send_id, campaign_id
      from email_campaign_recipients
      where id = $1::uuid
      limit 1
    `,
    [campaignRecipientId],
  );

  const context = contextResult.rows[0];

  if (!context?.send_id) {
    return;
  }

  await executeQuery(
    client,
    `
      with rollup as (
        select
          count(*)::int as recipient_total,
          count(*) filter (where status = 'queued')::int as queued_total,
          count(*) filter (where status = 'sending')::int as sending_total,
          count(*) filter (where status = 'failed')::int as failed_total,
          count(*) filter (where status = 'delivered')::int as delivered_total,
          count(*) filter (where status = 'unsubscribed')::int as unsubscribed_total
        from email_campaign_recipients
        where send_id = $1::uuid
      )
      update email_campaign_sends s
      set
        recipient_count = rollup.recipient_total,
        delivered_count = rollup.delivered_total,
        failed_count = rollup.failed_total,
        unsubscribed_count = rollup.unsubscribed_total,
        status = case
          when rollup.sending_total > 0 then 'sending'
          when rollup.queued_total > 0 then 'queued'
          when rollup.failed_total > 0 then 'failed'
          else 'sent'
        end,
        send_started_at = coalesce(s.send_started_at, now()),
        send_completed_at = case
          when rollup.sending_total > 0 or rollup.queued_total > 0 then null
          else now()
        end,
        updated_at = now()
      from rollup
      where s.id = $1::uuid
    `,
    [context.send_id],
  );

  await executeQuery(
    client,
    `
      with send_rollup as (
        select
          count(*) filter (where status = 'queued')::int as queued_total,
          count(*) filter (where status = 'sending')::int as sending_total
        from email_campaign_sends
        where campaign_id = $1::uuid
      ),
      latest_send as (
        select
          status,
          send_started_at,
          send_completed_at
        from email_campaign_sends
        where campaign_id = $1::uuid
        order by created_at desc, id desc
        limit 1
      )
      update email_campaigns c
      set
        status = case
          when send_rollup.sending_total > 0 then 'sending'
          when send_rollup.queued_total > 0 then 'queued'
          else coalesce(latest_send.status, c.status)
        end,
        send_started_at = case
          when send_rollup.sending_total > 0 then latest_send.send_started_at
          when send_rollup.queued_total > 0 then null
          when latest_send.status in ('sent', 'failed') then latest_send.send_started_at
          else c.send_started_at
        end,
        send_completed_at = case
          when send_rollup.sending_total > 0 or send_rollup.queued_total > 0 then null
          when latest_send.status in ('sent', 'failed') then latest_send.send_completed_at
          else c.send_completed_at
        end,
        updated_at = now()
      from send_rollup
      left join latest_send on true
      where c.id = $1::uuid
    `,
    [context.campaign_id],
  );
}

async function updateCampaignRecipientForDelivery(
  client: PoolClient,
  campaignRecipientId: string,
  occurredAt: string,
): Promise<void> {
  await executeQuery(
    client,
    `
      update email_campaign_recipients
      set
        status = case
          when status = 'failed' then status
          when status = 'unsubscribed' then status
          else 'delivered'
        end,
        delivered_at = coalesce(delivered_at, $2::timestamptz),
        updated_at = now()
      where id = $1::uuid
    `,
    [campaignRecipientId, occurredAt],
  );
}

async function updateCampaignRecipientForFailure(
  client: PoolClient,
  campaignRecipientId: string,
  occurredAt: string,
  failureReason: string,
): Promise<void> {
  await executeQuery(
    client,
    `
      update email_campaign_recipients
      set
        status = case
          when status = 'unsubscribed' then status
          else 'failed'
        end,
        failed_at = coalesce(failed_at, $2::timestamptz),
        failure_reason = $3,
        updated_at = now()
      where id = $1::uuid
    `,
    [campaignRecipientId, occurredAt, failureReason],
  );
}

async function updateContactForProviderEvent(
  client: PoolClient,
  input: {
    contactId: string;
    eventType: ProviderEventType;
    occurredAt: string;
  },
): Promise<void> {
  if (input.eventType === "delivered" || input.eventType === "reject") {
    return;
  }

  await executeQuery(
    client,
    `
      update email_contacts
      set
        status = case
          when $2 = 'complaint' then 'complained'
          when $2 = 'bounce_hard' and status <> 'complained' then 'bounced'
          else status
        end,
        last_bounce_at = case
          when $2 in ('bounce_hard', 'bounce_soft') then $3::timestamptz
          else last_bounce_at
        end,
        last_complaint_at = case
          when $2 = 'complaint' then $3::timestamptz
          else last_complaint_at
        end,
        last_provider_event_at = $3::timestamptz,
        updated_at = now()
      where id = $1::uuid
    `,
    [input.contactId, input.eventType, input.occurredAt],
  );
}

async function recordSuppressionEntry(
  client: PoolClient,
  input: {
    businessId: string;
    email: string;
    source: "bounce" | "complaint";
    reason: string;
  },
): Promise<void> {
  await executeQuery(
    client,
    `
      insert into email_unsubscribes (
        business_id,
        email,
        reason,
        source
      ) values (
        $1::uuid,
        lower($2),
        $3,
        $4
      )
      on conflict do nothing
    `,
    [input.businessId, input.email, input.reason, input.source],
  );
}

function buildFailureReason(event: NormalizedProviderEvent): string {
  if (event.eventType === "complaint") {
    return "Recipient reported this message as spam.";
  }

  if (event.eventType === "bounce_hard") {
    return "Recipient address hard bounced.";
  }

  if (event.eventType === "bounce_soft") {
    return "Recipient address soft bounced.";
  }

  return "SES rejected this message.";
}

export async function processSesWebhookNotification(body: unknown): Promise<SesWebhookProcessResult> {
  const envelope = parseObject(body) as SnsEnvelope;
  const notificationType = getString(envelope.Type) ?? "unknown";
  const allowlist = normalizeTopicAllowlist();

  if (allowlist.length > 0 && getString(envelope.TopicArn) && !allowlist.includes(envelope.TopicArn!)) {
    return {
      notificationType,
      processedEvents: 0,
      skippedEvents: 0,
      subscriptionConfirmed: false,
    };
  }

  if (notificationType === "SubscriptionConfirmation") {
    return {
      notificationType,
      processedEvents: 0,
      skippedEvents: 0,
      subscriptionConfirmed: await confirmSnsSubscription(getString(envelope.SubscribeURL)),
    };
  }

  if (notificationType !== "Notification") {
    return {
      notificationType,
      processedEvents: 0,
      skippedEvents: 0,
      subscriptionConfirmed: false,
    };
  }

  const notification = parseObject(envelope.Message) as SesNotificationPayload;
  const providerMessageId = getString(notification.mail?.messageId);

  if (!providerMessageId) {
    return {
      notificationType,
      processedEvents: 0,
      skippedEvents: 1,
      subscriptionConfirmed: false,
    };
  }

  const mailTags = notification.mail?.tags;
  const fallbackBusinessId = normalizeTagValue(mailTags, "business_id");
  const recipientIdTag = normalizeTagValue(mailTags, "recipient_id");
  const growthLeadIdTag = normalizeTagValue(mailTags, "lead_id");
  const growthRunIdTag = normalizeTagValue(mailTags, "run_id");
  const fallbackDomainName = extractDomainFromEmail(getString(notification.mail?.source));

  return withDbTransaction(async (client) => {
    const context = await resolveEventContext(client, {
      providerMessageId,
      fallbackBusinessId,
      fallbackDomainName,
      recipientIdTag,
    });

    if (!context) {
      return {
        notificationType,
        processedEvents: 0,
        skippedEvents: 1,
        subscriptionConfirmed: false,
      };
    }

    const normalizedEvents = normalizeProviderEvents(notification, context);
    let processedEvents = 0;
    let skippedEvents = 0;
    const reputationKeys = new Set<string>();

    for (const event of normalizedEvents) {
      const inserted = await insertProviderEvent(client, event);

      if (!inserted) {
        skippedEvents += 1;
        continue;
      }

      processedEvents += 1;
      reputationKeys.add(`${event.context.businessId}:${event.context.domainName}`);

      if (!event.context.campaignRecipientId) {
        continue;
      }

      if (event.eventType === "delivered") {
        await updateCampaignRecipientForDelivery(client, event.context.campaignRecipientId, event.occurredAt);
        await insertEmailEvent(client, {
          campaignRecipientId: event.context.campaignRecipientId,
          providerMessageId: event.providerMessageId,
          eventType: "delivered",
          payloadJson: event.rawPayloadJson,
          occurredAt: event.occurredAt,
        });
        await syncCampaignSendTrackingState(client, event.context.campaignRecipientId);

        await recordGrowthProviderFeedbackEvent(
          {
            providerMessageId: event.providerMessageId,
            eventType: "email_delivered",
            occurredAt: event.occurredAt,
            leadIdTag: growthLeadIdTag,
            runIdTag: growthRunIdTag,
            metadata: {
              source: "ses_webhook",
            },
          },
          client,
        );
        continue;
      }

      if (event.eventType === "bounce_hard" || event.eventType === "bounce_soft") {
        await updateCampaignRecipientForFailure(
          client,
          event.context.campaignRecipientId,
          event.occurredAt,
          buildFailureReason(event),
        );
        await insertEmailEvent(client, {
          campaignRecipientId: event.context.campaignRecipientId,
          providerMessageId: event.providerMessageId,
          eventType: "bounce",
          payloadJson: event.rawPayloadJson,
          occurredAt: event.occurredAt,
        });
        await syncCampaignSendTrackingState(client, event.context.campaignRecipientId);

        if (event.context.contactId) {
          await updateContactForProviderEvent(client, {
            contactId: event.context.contactId,
            eventType: event.eventType,
            occurredAt: event.occurredAt,
          });
        }

        if (event.eventType === "bounce_hard") {
          await recordSuppressionEntry(client, {
            businessId: event.context.businessId,
            email: event.recipientEmail,
            source: "bounce",
            reason: buildFailureReason(event),
          });
        }

        await recordGrowthProviderFeedbackEvent(
          {
            providerMessageId: event.providerMessageId,
            eventType: "email_bounced",
            occurredAt: event.occurredAt,
            leadIdTag: growthLeadIdTag,
            runIdTag: growthRunIdTag,
            metadata: {
              source: "ses_webhook",
              bounceType: event.eventType,
              subtype: event.subtype ?? null,
              failureReason: buildFailureReason(event),
            },
          },
          client,
        );

        continue;
      }

      if (event.eventType === "complaint") {
        await updateCampaignRecipientForFailure(
          client,
          event.context.campaignRecipientId,
          event.occurredAt,
          buildFailureReason(event),
        );
        await insertEmailEvent(client, {
          campaignRecipientId: event.context.campaignRecipientId,
          providerMessageId: event.providerMessageId,
          eventType: "complaint",
          payloadJson: event.rawPayloadJson,
          occurredAt: event.occurredAt,
        });
        await syncCampaignSendTrackingState(client, event.context.campaignRecipientId);

        if (event.context.contactId) {
          await updateContactForProviderEvent(client, {
            contactId: event.context.contactId,
            eventType: event.eventType,
            occurredAt: event.occurredAt,
          });
        }

        await recordSuppressionEntry(client, {
          businessId: event.context.businessId,
          email: event.recipientEmail,
          source: "complaint",
          reason: buildFailureReason(event),
        });

        await recordGrowthProviderFeedbackEvent(
          {
            providerMessageId: event.providerMessageId,
            eventType: "email_complained",
            occurredAt: event.occurredAt,
            leadIdTag: growthLeadIdTag,
            runIdTag: growthRunIdTag,
            metadata: {
              source: "ses_webhook",
              subtype: event.subtype ?? null,
              failureReason: buildFailureReason(event),
            },
          },
          client,
        );
        continue;
      }

      if (event.eventType === "reject") {
        await updateCampaignRecipientForFailure(
          client,
          event.context.campaignRecipientId,
          event.occurredAt,
          buildFailureReason(event),
        );
        await insertEmailEvent(client, {
          campaignRecipientId: event.context.campaignRecipientId,
          providerMessageId: event.providerMessageId,
          eventType: "failed",
          payloadJson: event.rawPayloadJson,
          occurredAt: event.occurredAt,
        });
        await syncCampaignSendTrackingState(client, event.context.campaignRecipientId);
      }
    }

    for (const key of reputationKeys) {
      const [businessId, domainName] = key.split(":");

      if (businessId && domainName) {
        await recalculateEmailDomainReputation({
          businessId,
          domainName,
          client,
        });
      }
    }

    return {
      notificationType,
      processedEvents,
      skippedEvents,
      subscriptionConfirmed: false,
    };
  });
}
