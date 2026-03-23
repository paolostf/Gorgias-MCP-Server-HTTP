import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { gorgiasClient } from './gorgias-client.js';

// Convert [[variable]] placeholders to {{variable}} for Gorgias template variables.
// The Notion agent conversation system strips double curly braces, so the agent uses
// double square brackets as an escape syntax. This function converts them back.
function convertPlaceholders(text) {
  if (!text) return text;
  return text.replace(/\[\[([^\]]+)\]\]/g, '{{$1}}');
}

// Auto-correct variable names to the format Gorgias ACTUALLY recognizes.
// Gorgias uses: ticket.customer.firstname (NO underscore), current_user.firstname (NOT current_agent).
// Verified from working macros with 9000+ usages (R1, E3A, T6).
const VARIABLE_CORRECTIONS = {
  'ticket.customer.first_name': 'ticket.customer.firstname',
  'ticket.customer.last_name': 'ticket.customer.lastname',
  'ticket.customer.full_name': 'ticket.customer.fullname',
  'current_agent.first_name': 'current_user.firstname',
  'current_agent.last_name': 'current_user.lastname',
  'current_agent.firstname': 'current_user.firstname',
  'current_agent.lastname': 'current_user.lastname',
  'current_agent.name': 'current_user.firstname',
  'ticket.assignee_name': 'current_user.firstname',
  'ticket.assignee_user.name': 'current_user.firstname',
  'ticket.assignee_user.firstname': 'current_user.firstname',
  'ticket.customer.name': 'ticket.customer.firstname',
};

function fixVariableNames(text) {
  if (!text) return text;
  let result = text;
  for (const [wrong, correct] of Object.entries(VARIABLE_CORRECTIONS)) {
    // Fix inside {{...}} and [[...]] and plain text references
    result = result.replace(new RegExp(wrong.replace(/\./g, '\\.'), 'gi'), correct);
  }
  return result;
}

// Apply both placeholder conversion AND variable name correction
function processTemplateText(text) {
  if (!text) return text;
  return convertPlaceholders(fixVariableNames(text));
}

// Generic auto-pagination helper for list endpoints
async function fetchAllPages(apiMethod, params = {}, maxPages = 50) {
  let allItems = [];
  let nextCursor = undefined;
  let page = 0;
  do {
    const p = { ...params, limit: 100 };
    if (nextCursor) p.cursor = nextCursor;
    const response = await apiMethod(p);
    const data = response.data;
    const items = data?.data || (Array.isArray(data) ? data : []);
    allItems = allItems.concat(items);
    nextCursor = data?.meta?.next_cursor || null;
    page++;
  } while (nextCursor && page < maxPages);
  return { items: allItems, pages: page };
}

function createServer() {
  const server = new McpServer({
    name: "Gorgias API",
    version: "1.0.0",
    description: "MCP server for interacting with the Gorgias helpdesk API"
  });

  // ===== TICKET TOOLS =====

  server.tool(
    "list_tickets",
    {
      fetch_all: z.boolean().default(false).describe("true = auto-paginate ALL matching tickets. false (DEFAULT) = single page."),
      limit: z.number().min(1).max(100).default(20).describe("Results per page"),
      cursor: z.string().optional().describe("Pagination cursor (only when fetch_all=false)"),
      order_by: z.string().optional().describe("Field to order by (e.g. created_datetime)"),
      order_dir: z.enum(["asc", "desc"]).optional().describe("Order direction"),
      customer_id: z.number().optional().describe("Filter by customer ID"),
      assignee_user_id: z.number().optional().describe("Filter by assignee user ID"),
      channel: z.string().optional().describe("Filter by channel")
    },
    async ({ fetch_all, limit, cursor, ...filters }) => {
      try {
        if (fetch_all) {
          let allTickets = [];
          let nextCursor = undefined;
          let page = 0;
          const maxPages = 50;
          do {
            const params = { limit: 100, ...filters };
            if (nextCursor) params.cursor = nextCursor;
            const response = await gorgiasClient.listTickets(params);
            const data = response.data;
            const tickets = data?.data || data || [];
            allTickets = allTickets.concat(tickets);
            nextCursor = data?.meta?.next_cursor || null;
            page++;
          } while (nextCursor && page < maxPages);
          return { content: [{ type: "text", text: `${allTickets.length} tickets found (${page} pages)\n\n${JSON.stringify(allTickets, null, 2)}` }] };
        } else {
          const params = { limit, ...filters };
          if (cursor) params.cursor = cursor;
          const response = await gorgiasClient.listTickets(params);
          return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
        }
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
    { description: "List tickets with optional filters. Set fetch_all=true to auto-paginate ALL results. NOTE: For ticket discovery, prefer get_view_tickets with view IDs (faster, more reliable). list_tickets does NOT support tag_id or status filters." }
  );

  server.tool(
    "get_ticket",
    { id: z.number().describe("Ticket ID") },
    async ({ id }) => {
      try {
        const response = await gorgiasClient.getTicket(id);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
    { description: "Get a specific ticket by ID with all messages and details" }
  );

  server.tool(
    "create_ticket",
    { subject: z.string().describe("Ticket subject"), body_text: z.string().describe("Message body text"), customer_email: z.string().email().describe("Customer email"), channel: z.string().default("api").describe("Channel"), via: z.string().default("api").describe("Via source"), from_agent: z.boolean().default(true).describe("Whether message is from agent (true) or customer (false)") },
    async ({ subject, body_text, customer_email, channel, via, from_agent }) => {
      try {
        const ticketData = {
          subject, channel, via,
          customer: { email: customer_email },
          messages: [{ body_text, channel, via, from_agent }]
        };
        const response = await gorgiasClient.createTicket(ticketData);
        return { content: [{ type: "text", text: `Ticket created with ID: ${response.data.id}` }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
    { description: "Create a new ticket with full body content" }
  );

  server.tool(
    "update_ticket",
    { id: z.number().describe("Ticket ID"), status: z.string().optional().describe("Status (open, closed)"), assignee_user_id: z.number().optional().describe("Assignee user ID"), priority: z.string().optional().describe("Priority"), subject: z.string().optional().describe("Subject"), spam: z.boolean().optional().describe("Mark as spam") },
    async ({ id, ...data }) => {
      try {
        await gorgiasClient.updateTicket(id, data);
        return { content: [{ type: "text", text: `Ticket ${id} updated` }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
    { description: "Update a ticket (status, assignee, priority, subject, spam)" }
  );

  server.tool(
    "delete_ticket",
    { id: z.number().describe("Ticket ID") },
    async ({ id }) => {
      try {
        await gorgiasClient.deleteTicket(id);
        return { content: [{ type: "text", text: `Ticket ${id} deleted` }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
    { description: "⚠️ DANGER: Permanently delete a ticket. IRREVERSIBLE — all messages, notes, and history are lost forever. Consider closing the ticket instead." }
  );

  server.tool(
    "search_tickets",
    {
      query: z.string().describe("Search query"),
      fetch_all: z.boolean().default(false).describe("true = auto-paginate all results. false (DEFAULT) = single page."),
      limit: z.number().min(1).max(100).default(20).describe("Results per page"),
      cursor: z.string().optional().describe("Pagination cursor (only when fetch_all=false)")
    },
    async ({ query, fetch_all, limit, cursor }) => {
      try {
        if (fetch_all) {
          let allTickets = [];
          let nextCursor = undefined;
          let page = 0;
          const maxPages = 20;
          do {
            const params = { limit: 100 };
            if (nextCursor) params.cursor = nextCursor;
            const response = await gorgiasClient.searchTickets(query, params);
            const data = response.data;
            const tickets = data?.data || data || [];
            allTickets = allTickets.concat(tickets);
            nextCursor = data?.meta?.next_cursor || null;
            page++;
          } while (nextCursor && page < maxPages);
          return { content: [{ type: "text", text: `Search "${query}": ${allTickets.length} total results\n\n${JSON.stringify(allTickets, null, 2)}` }] };
        } else {
          const params = { limit };
          if (cursor) params.cursor = cursor;
          const response = await gorgiasClient.searchTickets(query, params);
          return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
        }
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
    { description: "Search tickets by query string. Set fetch_all=true to get all matching results with auto-pagination." }
  );

  // ===== MESSAGE TOOLS =====

  server.tool(
    "list_messages",
    {
      ticket_id: z.number().describe("Ticket ID"),
      fetch_all: z.boolean().default(true).describe("true (DEFAULT) = auto-paginate and return ALL messages. false = return single page only."),
      limit: z.number().min(1).max(100).default(30).describe("Results per page (used during pagination)"),
      cursor: z.string().optional().describe("Pagination cursor (only used when fetch_all=false)")
    },
    async ({ ticket_id, fetch_all, limit, cursor }) => {
      try {
        let allMessages = [];

        if (fetch_all) {
          // AUTO-PAGINATE: fetch every message in the ticket
          let nextCursor = undefined;
          let page = 0;
          const maxPages = 20; // Safety: max 2000 messages
          do {
            const params = { limit: 100 }; // Max per page for speed
            if (nextCursor) params.cursor = nextCursor;
            const response = await gorgiasClient.listMessages(ticket_id, params);
            const data = response.data;
            const messages = data?.data || data || [];
            allMessages = allMessages.concat(messages);
            nextCursor = data?.meta?.next_cursor || null;
            page++;
          } while (nextCursor && page < maxPages);
        } else {
          // Single page mode
          const params = { limit };
          if (cursor) params.cursor = cursor;
          const response = await gorgiasClient.listMessages(ticket_id, params);
          const data = response.data;
          allMessages = data?.data || data || [];
          // Include pagination info for manual cursor use
          const meta = data?.meta;
          if (meta?.next_cursor) {
            allMessages._nextCursor = meta.next_cursor;
          }
        }

        // FORMAT: structured, readable output — same view as human agents
        const formatted = allMessages.map(msg => {
          const sender = msg.sender || {};
          const senderName = sender.firstname || sender.name || sender.email || 'Unknown';
          const senderEmail = sender.email || msg.from_agent ? '(agent)' : '(customer)';
          const channel = msg.channel || 'unknown';
          const isNote = channel === 'internal-note';
          const isChat = channel === 'chat';
          const isEmail = channel === 'email';
          const date = msg.created_datetime || msg.sent_datetime || '';
          const formattedDate = date ? new Date(date).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : 'no date';
          const fromAgent = msg.from_agent === true;

          // Channel label
          let channelLabel = isNote ? '📝 INTERNAL NOTE' : isChat ? '💬 CHAT' : isEmail ? '📧 EMAIL' : `📨 ${channel.toUpperCase()}`;
          let roleLabel = fromAgent ? '🤖 AGENT' : '👤 CUSTOMER';
          if (isNote) roleLabel = '📝 NOTE';

          // Body: prefer text, fall back to stripped HTML
          let body = msg.body_text || '';
          if (!body && msg.body_html) {
            body = msg.body_html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          }
          if (body.length > 2000) body = body.substring(0, 2000) + '... [truncated]';

          // Attachments
          const attachments = msg.attachments || [];
          const attachStr = attachments.length > 0
            ? `\n   📎 Attachments: ${attachments.map(a => a.name || a.url).join(', ')}`
            : '';

          return `[${formattedDate}] ${channelLabel} | ${roleLabel} — ${senderName} <${senderEmail}>\n${body}${attachStr}`;
        });

        // Sort chronologically (oldest first)
        const sortedMessages = [...allMessages].sort((a, b) => {
          const dateA = new Date(a.created_datetime || a.sent_datetime || 0);
          const dateB = new Date(b.created_datetime || b.sent_datetime || 0);
          return dateA - dateB;
        });

        const formattedSorted = sortedMessages.map(msg => {
          const sender = msg.sender || {};
          const senderName = sender.firstname || sender.name || sender.email || 'Unknown';
          const senderEmail = sender.email || (msg.from_agent ? 'agent' : 'customer');
          const channel = msg.channel || 'unknown';
          const isNote = channel === 'internal-note';
          const isChat = channel === 'chat';
          const isEmail = channel === 'email';
          const date = msg.created_datetime || msg.sent_datetime || '';
          const formattedDate = date ? new Date(date).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : 'no date';
          const fromAgent = msg.from_agent === true;

          let channelLabel = isNote ? '📝 INTERNAL NOTE' : isChat ? '💬 CHAT' : isEmail ? '📧 EMAIL' : `📨 ${channel.toUpperCase()}`;
          let roleLabel = fromAgent ? '🤖 AGENT' : '👤 CUSTOMER';
          if (isNote) roleLabel = '📝 NOTE';

          let body = msg.body_text || '';
          if (!body && msg.body_html) {
            body = msg.body_html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          }
          if (body.length > 2000) body = body.substring(0, 2000) + '... [truncated]';

          const attachments = msg.attachments || [];
          const attachStr = attachments.length > 0
            ? `\n   📎 Attachments: ${attachments.map(a => a.name || a.url).join(', ')}`
            : '';

          return `[${formattedDate}] ${channelLabel} | ${roleLabel} — ${senderName} <${senderEmail}>\n${body}${attachStr}`;
        });

        const header = `=== TICKET #${ticket_id} — ${allMessages.length} messages (${fetch_all ? 'ALL fetched' : 'single page'}) ===\n`;
        const noteCount = allMessages.filter(m => m.channel === 'internal-note').length;
        const emailCount = allMessages.filter(m => m.channel === 'email').length;
        const chatCount = allMessages.filter(m => m.channel === 'chat').length;
        const otherCount = allMessages.length - noteCount - emailCount - chatCount;
        const stats = `📊 Breakdown: ${emailCount} emails, ${noteCount} internal notes, ${chatCount} chat${otherCount > 0 ? `, ${otherCount} other` : ''}\n`;

        const output = header + stats + '\n' + formattedSorted.join('\n\n---\n\n');
        return { content: [{ type: "text", text: output }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
    { description: "List ALL messages for a ticket with full conversation view. Auto-paginates by default (fetch_all=true) to show EVERY message. Output is formatted chronologically with sender name, email, date, channel type (📧 EMAIL / 📝 INTERNAL NOTE / 💬 CHAT), role (AGENT/CUSTOMER), body text, and attachments. Shows the SAME conversation human agents see in Gorgias." }
  );

  server.tool(
    "get_message",
    { ticket_id: z.number().describe("Ticket ID"), message_id: z.number().describe("Message ID") },
    async ({ ticket_id, message_id }) => {
      try {
        const response = await gorgiasClient.getMessage(ticket_id, message_id);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
    { description: "Get a specific message from a ticket" }
  );

  server.tool(
    "add_message_to_ticket",
    { ticket_id: z.number().describe("Ticket ID"), body_text: z.string().describe("Message body text (plain text)"), body_html: z.string().optional().describe("Message body HTML (optional, for rich formatting)"), from_agent: z.boolean().default(true).describe("true = message from agent, false = message from customer"), channel: z.string().default("email").describe("Channel: email, internal-note, chat, etc"), via: z.string().default("api").describe("Via source"), from_address: z.string().email().default("info@deflorance.com").describe("Sender email address for email replies (e.g. info@deflorance.com)"), to_address: z.string().email().optional().describe("Recipient email address (auto-filled from ticket customer if omitted)"), attachments: z.array(z.object({ url: z.string().describe("Public URL of the file"), name: z.string().describe("File name (e.g. return-label.pdf)"), content_type: z.string().describe("MIME type (e.g. application/pdf, image/png)") })).optional().describe("File attachments array. Get attachment URLs from get_macro response. Each item needs url, name, content_type.") },
    async ({ ticket_id, body_text, body_html, from_agent, channel, via, from_address, to_address, attachments }) => {
      try {
        // Auto-populate to_address from ticket customer if not provided
        let recipientAddress = to_address;
        if (!recipientAddress && channel === 'email') {
          const ticketResp = await gorgiasClient.getTicket(ticket_id);
          const customer = ticketResp.data?.customer;
          if (customer?.email) recipientAddress = customer.email;
        }
        const messageData = {
          body_text, from_agent, channel, via,
          source: { from: { address: from_address } }
        };
        if (recipientAddress) messageData.source.to = [{ address: recipientAddress }];
        if (body_html) messageData.body_html = body_html;
        if (attachments && attachments.length > 0) messageData.attachments = attachments;
        // Attribute message to "Ares" agent so it appears in Gorgias stats
        if (from_agent) {
          messageData.sender = { email: 'dfkh@deflorance.com' };
        }
        await gorgiasClient.addMessageToTicket(ticket_id, messageData);
        // Auto-tag: add "replied" and remove "unreplied" — mirrors human agent behavior
        // Auto-assign ticket to Ares so stats track correctly
        let tagStatus = '';
        if (from_agent) {
          try {
            const usersResp = await gorgiasClient.listUsers({ limit: 100 });
            const allUsers = usersResp.data?.data || usersResp.data || [];
            const aresUser = allUsers.find(u => u.email === 'dfkh@deflorance.com');
            if (aresUser) {
              await gorgiasClient.updateTicket(ticket_id, { assignee_user: { id: aresUser.id } });
            }
          } catch (assignErr) { /* non-blocking */ }
          try {
            const tagsResp = await gorgiasClient.listTags({ limit: 100 });
            const allTags = tagsResp.data?.data || tagsResp.data || [];
            const repliedTag = allTags.find(t => t.name && t.name.toLowerCase() === 'replied');
            const unrepliedTag = allTags.find(t => t.name && t.name.toLowerCase() === 'unreplied');
            if (repliedTag) await gorgiasClient.addTagToTicket(ticket_id, repliedTag.id);
            if (unrepliedTag) await gorgiasClient.removeTagFromTicket(ticket_id, unrepliedTag.id);
            tagStatus = '. Auto-tagged + assigned to Ares.';
          } catch (tagErr) { tagStatus = '. Auto-tag attempted but failed (non-blocking).'; }
        }
        return { content: [{ type: "text", text: `Message added to ticket ${ticket_id} (sent to ${recipientAddress || 'N/A'})${attachments ? ` with ${attachments.length} attachment(s)` : ''}${tagStatus}` }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
    { description: "Add a reply/message to a ticket. Set from_agent=true for agent replies. Default sends from info@deflorance.com. Set channel='email' for email reply, 'internal-note' for internal note. To include macro attachments: first call get_macro to get attachment URLs, then pass them in the attachments array." }
  );

  server.tool(
    "delete_message",
    { ticket_id: z.number().describe("Ticket ID"), message_id: z.number().describe("Message ID") },
    async ({ ticket_id, message_id }) => {
      try {
        await gorgiasClient.deleteMessage(ticket_id, message_id);
        return { content: [{ type: "text", text: `Message ${message_id} deleted from ticket ${ticket_id}` }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
    { description: "⚠️ DANGER: Permanently delete a message from a ticket. IRREVERSIBLE — message history is lost forever." }
  );

  // ===== CUSTOMER TOOLS =====

  server.tool(
    "list_customers",
    { fetch_all: z.boolean().default(false).describe("true = get ALL customers. false (DEFAULT) = single page."), limit: z.number().min(1).max(100).default(20).describe("Results per page"), cursor: z.string().optional().describe("Pagination cursor"), email: z.string().email().optional().describe("Filter by email") },
    async ({ fetch_all, limit, cursor, ...filters }) => {
      try {
        if (fetch_all) {
          const { items, pages } = await fetchAllPages((p) => gorgiasClient.listCustomers({ ...p, ...filters }));
          return { content: [{ type: "text", text: `${items.length} customers found (${pages} pages)\n\n${JSON.stringify(items, null, 2)}` }] };
        }
        const params = { limit, ...filters };
        if (cursor) params.cursor = cursor;
        const response = await gorgiasClient.listCustomers(params);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
    { description: "List customers with optional email filter. Set fetch_all=true to auto-paginate all results." }
  );

  server.tool(
    "get_customer",
    { id: z.number().describe("Customer ID") },
    async ({ id }) => {
      try {
        const response = await gorgiasClient.getCustomer(id);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
    { description: "Get a customer by ID" }
  );

  server.tool(
    "create_customer",
    { name: z.string().describe("Name"), email: z.string().email().optional().describe("Email"), note: z.string().optional().describe("Note") },
    async (data) => {
      try {
        const response = await gorgiasClient.createCustomer(data);
        return { content: [{ type: "text", text: `Customer created with ID: ${response.data.id}` }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
    { description: "Create a new customer" }
  );

  server.tool(
    "update_customer",
    { id: z.number().describe("Customer ID"), name: z.string().optional().describe("Name"), email: z.string().email().optional().describe("Email"), note: z.string().optional().describe("Note") },
    async ({ id, ...data }) => {
      try {
        await gorgiasClient.updateCustomer(id, data);
        return { content: [{ type: "text", text: `Customer ${id} updated` }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
    { description: "Update a customer" }
  );

  // ===== TAG TOOLS =====

  server.tool(
    "list_tags",
    { fetch_all: z.boolean().default(true).describe("true (DEFAULT) = auto-paginate ALL tags. false = single page."), limit: z.number().min(1).max(100).default(30).describe("Results per page"), cursor: z.string().optional().describe("Pagination cursor") },
    async ({ fetch_all, limit, cursor }) => {
      try {
        if (fetch_all) {
          const { items, pages } = await fetchAllPages((p) => gorgiasClient.listTags(p));
          return { content: [{ type: "text", text: `${items.length} tags found (${pages} pages)\n\n${JSON.stringify(items, null, 2)}` }] };
        }
        const params = { limit };
        if (cursor) params.cursor = cursor;
        const response = await gorgiasClient.listTags(params);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
    { description: "List all tags. Auto-paginates by default (fetch_all=true) to return ALL tags." }
  );

  server.tool(
    "create_tag",
    { name: z.string().describe("Tag name") },
    async (data) => {
      try {
        // Duplicate check: see if tag with same name already exists
        try {
          const existing = await gorgiasClient.listTags({ limit: 100 });
          const allTags = existing.data?.data || existing.data || [];
          const dup = allTags.find(t => t.name && t.name.toLowerCase() === data.name.toLowerCase());
          if (dup) {
            return { content: [{ type: "text", text: `DUPLICATE BLOCKED: Tag "${dup.name}" already exists (ID: ${dup.id}). Use this ID directly.` }], isError: true };
          }
        } catch (dupErr) { /* non-blocking */ }
        const response = await gorgiasClient.createTag(data);
        return { content: [{ type: "text", text: `Tag created: ${response.data.name} (ID: ${response.data.id})` }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
    { description: "Create a new tag. CHECKS FOR DUPLICATES — blocks if tag name already exists." }
  );

  server.tool(
    "add_tag_to_ticket",
    { ticket_id: z.number().describe("Ticket ID"), tag_id: z.number().describe("Tag ID") },
    async ({ ticket_id, tag_id }) => {
      try {
        await gorgiasClient.addTagToTicket(ticket_id, tag_id);
        return { content: [{ type: "text", text: `Tag ${tag_id} added to ticket ${ticket_id}` }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
    { description: "Add a tag to a ticket" }
  );

  server.tool(
    "remove_tag_from_ticket",
    { ticket_id: z.number().describe("Ticket ID"), tag_id: z.number().describe("Tag ID") },
    async ({ ticket_id, tag_id }) => {
      try {
        await gorgiasClient.removeTagFromTicket(ticket_id, tag_id);
        return { content: [{ type: "text", text: `Tag ${tag_id} removed from ticket ${ticket_id}` }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
    { description: "Remove a tag from a ticket" }
  );

  // ===== MACRO TOOLS =====

  server.tool(
    "list_macros",
    { fetch_all: z.boolean().default(true).describe("true (DEFAULT) = get ALL macros. false = single page."), limit: z.number().min(1).max(100).default(30).describe("Results per page"), cursor: z.string().optional().describe("Pagination cursor") },
    async ({ fetch_all, limit, cursor }) => {
      try {
        if (fetch_all) {
          const { items, pages } = await fetchAllPages((p) => gorgiasClient.listMacros(p));
          return { content: [{ type: "text", text: `${items.length} macros found (${pages} pages)\n\n${JSON.stringify(items, null, 2)}` }] };
        }
        const params = { limit };
        if (cursor) params.cursor = cursor;
        const response = await gorgiasClient.listMacros(params);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
    { description: "List all macros (saved replies/templates). Auto-paginates by default to return ALL macros." }
  );

  server.tool(
    "get_macro",
    { id: z.number().describe("Macro ID") },
    async ({ id }) => {
      try {
        const response = await gorgiasClient.getMacro(id);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
    { description: "Get a specific macro by ID" }
  );

  server.tool(
    "create_macro",
    { name: z.string().describe("Macro name — MUST be unique. Server checks for duplicates before creating."), body_text: z.string().optional().describe("Response body plain text — auto-creates setResponseText action"), body_html: z.string().optional().describe("Response body HTML — auto-creates setResponseText action"), actions: z.array(z.object({ name: z.string().describe("Action name: setResponseText, setStatus, addTags, removeTags, addAttachments"), title: z.string().optional().describe("Action display title"), type: z.string().optional().default("user").describe("Action type: user or system"), arguments: z.record(z.any()).optional().describe("Action arguments") })).optional().describe("Full Gorgias actions array"), attachments: z.array(z.object({ url: z.string(), name: z.string(), content_type: z.string() })).optional().describe("File attachments with url, name, content_type") },
    async ({ name, body_text, body_html, actions, attachments }) => {
      try {
        // DUPLICATE CHECK: Search for existing macro with same name before creating
        let duplicateWarning = '';
        try {
          const existingMacros = await gorgiasClient.listMacros({ limit: 100 });
          const allMacros = existingMacros.data?.data || existingMacros.data || [];
          const duplicate = allMacros.find(m => m.name && m.name.toLowerCase() === name.toLowerCase());
          if (duplicate) {
            return { content: [{ type: "text", text: `DUPLICATE BLOCKED: A macro named "${duplicate.name}" already exists (ID: ${duplicate.id}). Use update_macro to modify it, or choose a different name.` }], isError: true };
          }
        } catch (dupErr) { /* non-blocking — proceed with creation */ }

        const macroData = { name };
        if (attachments) macroData.attachments = attachments;

        // Process template text: fix variable names + convert [[var]] → {{var}}
        const safeBodyText = processTemplateText(body_text);
        const safeBodyHtml = processTemplateText(body_html);

        // Build actions array
        let finalActions = actions || [];

        // Process placeholders and variable names inside action arguments
        finalActions = finalActions.map(a => {
          if (a.arguments) {
            const converted = { ...a.arguments };
            if (converted.body_text) converted.body_text = processTemplateText(converted.body_text);
            if (converted.body_html) converted.body_html = processTemplateText(converted.body_html);
            return { ...a, arguments: converted };
          }
          return a;
        });

        // Auto-create setResponseText if body provided but no such action exists
        if ((safeBodyText || safeBodyHtml) && !finalActions.some(a => a.name === 'setResponseText')) {
          const msgArgs = {};
          if (safeBodyText) msgArgs.body_text = safeBodyText;
          if (safeBodyHtml) msgArgs.body_html = safeBodyHtml;
          finalActions = [{ name: 'setResponseText', title: 'Set response text', type: 'user', arguments: msgArgs }, ...finalActions];
        }

        if (finalActions.length > 0) macroData.actions = finalActions;

        const response = await gorgiasClient.createMacro(macroData);
        return { content: [{ type: "text", text: `Macro created: ${response.data.name} (ID: ${response.data.id})` }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
    { description: "Create a new macro. CHECKS FOR DUPLICATES — will block if name already exists. Pass body_text/body_html for auto response text, or full actions array. Valid actions: setResponseText, setStatus, addTags, removeTags, addAttachments. For template variables use DOUBLE SQUARE BRACKETS: [[ticket.customer.firstname]], [[current_user.firstname]], [[ticket.id]]. CORRECT Gorgias variable names (NO underscores): ticket.customer.firstname, ticket.customer.lastname, current_user.firstname, ticket.id, ticket.subject. Server auto-corrects wrong names." }
  );

  server.tool(
    "update_macro",
    {
      id: z.number().describe("Macro ID"),
      mode: z.enum(["add", "replace"]).default("add").describe("Mode: 'add' (DEFAULT, SAFE) = only adds/merges on top of existing, NEVER removes anything. 'replace' = full replacement of actions array (DANGEROUS, use only when explicitly intended)."),
      name: z.string().optional().describe("Macro name (auto-preserved if omitted)"),
      body_text: z.string().optional().describe("Response body plain text"),
      body_html: z.string().optional().describe("Response body HTML"),
      actions: z.array(z.object({ name: z.string().describe("Action name: setResponseText, setStatus, addTags, removeTags, addAttachments"), title: z.string().optional(), type: z.string().optional().default("user"), arguments: z.record(z.any()).optional() })).optional().describe("Actions to add/merge (mode=add) or full replacement (mode=replace)"),
      attachments: z.array(z.object({ url: z.string(), name: z.string(), content_type: z.string() })).optional().describe("File attachments")
    },
    async ({ id, mode, name, body_text, body_html, actions, attachments }) => {
      try {
        // ALWAYS fetch existing macro — needed for name, actions, attachments preservation
        const existingResp = await gorgiasClient.getMacro(id);
        const existingData = existingResp.data;
        const existingActions = existingData.actions || [];

        const macroData = {};
        macroData.name = name || existingData.name;

        // Attachments: ALWAYS preserved unless explicitly provided
        if (attachments) {
          macroData.attachments = attachments;
        } else if (existingData.attachments && existingData.attachments.length > 0) {
          macroData.attachments = existingData.attachments;
        }

        // Process template text: fix variable names + convert [[var]] → {{var}}
        const safeBodyText = processTemplateText(body_text);
        const safeBodyHtml = processTemplateText(body_html);

        // Build new actions from input
        let newActions = actions || [];
        newActions = newActions.map(a => {
          if (a.arguments) {
            const converted = { ...a.arguments };
            if (converted.body_text) converted.body_text = processTemplateText(converted.body_text);
            if (converted.body_html) converted.body_html = processTemplateText(converted.body_html);
            return { ...a, arguments: converted };
          }
          return a;
        });

        // Auto-create setResponseText if body_text/body_html provided
        if ((safeBodyText || safeBodyHtml) && !newActions.some(a => a.name === 'setResponseText')) {
          const msgArgs = {};
          if (safeBodyText) msgArgs.body_text = safeBodyText;
          if (safeBodyHtml) msgArgs.body_html = safeBodyHtml;
          newActions = [{ name: 'setResponseText', title: 'Set response text', type: 'user', arguments: msgArgs }, ...newActions];
        }

        let finalActions;
        let modeUsed;

        if (mode === 'replace') {
          // ===== REPLACE MODE: Full replacement (DANGEROUS) =====
          // Uses ONLY the new actions. Existing actions are DISCARDED.
          // Still preserves name and top-level attachments.
          finalActions = newActions;
          modeUsed = 'REPLACE (full overwrite)';
        } else {
          // ===== ADD MODE (DEFAULT): Append-only, never removes =====
          // Rule 1: ALL existing actions are preserved as baseline
          // Rule 2: addAttachments — UNTOUCHABLE, never modified
          // Rule 3: addTags/removeTags — MERGE arrays (existing + new, deduplicated)
          // Rule 4: setResponseText/setStatus — content updated if new value provided
          // Rule 5: New action types not in existing — APPENDED

          // Start with a copy of ALL existing actions
          finalActions = existingActions.map(a => ({ ...a }));

          const newActionsByName = {};
          for (const a of newActions) newActionsByName[a.name] = a;

          // Update existing actions in-place
          for (let i = 0; i < finalActions.length; i++) {
            const existing = finalActions[i];
            const newAction = newActionsByName[existing.name];
            if (!newAction) continue; // No update for this action — keep as-is

            if (existing.name === 'addAttachments') {
              // UNTOUCHABLE — never modify, never remove
              // Do nothing, keep existing exactly as-is
            } else if (existing.name === 'addTags' || existing.name === 'removeTags') {
              // MERGE: combine existing tags + new tags, deduplicate
              // Gorgias stores tags as COMMA-SEPARATED STRING (e.g. "tag1,tag2") or single string "tag1"
              const rawExisting = existing.arguments?.tags || '';
              const rawNew = newAction.arguments?.tags || '';
              // Normalize both to arrays of strings
              const toArr = (v) => {
                if (Array.isArray(v)) return v.map(String);
                if (typeof v === 'string' && v) return v.split(',').map(s => s.trim()).filter(Boolean);
                return [];
              };
              const merged = [...new Set([...toArr(rawExisting), ...toArr(rawNew)])];
              // Gorgias expects comma-separated string for tags in macro actions
              const finalTags = merged.join(',');
              finalActions[i] = { ...existing, arguments: { ...existing.arguments, tags: finalTags } };
            } else {
              // setResponseText, setStatus, etc: update content
              finalActions[i] = newAction;
            }
            delete newActionsByName[existing.name]; // handled
          }

          // Append any truly NEW action types that didn't exist before
          for (const [, action] of Object.entries(newActionsByName)) {
            finalActions.push(action);
          }

          modeUsed = 'ADD (append-only, existing preserved)';
        }

        if (finalActions.length > 0) {
          macroData.actions = finalActions;
        }

        await gorgiasClient.updateMacro(id, macroData);

        // Build detailed response showing exactly what happened
        const actionNames = finalActions.map(a => a.name);
        const existingNames = existingActions.map(a => a.name);
        let detail = `Macro ${id} updated [${modeUsed}] (name: ${macroData.name}).`;
        detail += ` Actions before: [${existingNames.join(', ')}]. Actions after: [${actionNames.join(', ')}].`;

        return { content: [{ type: "text", text: detail }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
    { description: "Update a macro. TWO MODES: mode='add' (DEFAULT, SAFE) — only adds/merges on top of existing actions, NEVER removes anything. addAttachments are UNTOUCHABLE. addTags are MERGED (combined, never replaced). setResponseText content is updated. mode='replace' — DANGEROUS full replacement, only use when explicitly intended. Name and attachments always auto-preserved. For template variables use [[ticket.customer.firstname]], [[current_user.firstname]], [[ticket.id]]. NO underscores in variable names." }
  );

  server.tool(
    "delete_macro",
    { id: z.number().describe("Macro ID") },
    async ({ id }) => {
      try {
        await gorgiasClient.deleteMacro(id);
        return { content: [{ type: "text", text: `Macro ${id} deleted` }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
    { description: "⚠️ DANGER: Permanently delete a macro. IRREVERSIBLE — must be recreated from scratch if deleted by mistake." }
  );

  // ===== SATISFACTION SURVEY TOOLS =====

  server.tool(
    "list_satisfaction_surveys",
    { fetch_all: z.boolean().default(false).describe("true = get ALL surveys. false (DEFAULT) = single page."), limit: z.number().min(1).max(100).default(30).describe("Results per page"), cursor: z.string().optional().describe("Pagination cursor"), ticket_id: z.number().optional().describe("Filter by ticket ID") },
    async ({ fetch_all, limit, cursor, ...filters }) => {
      try {
        if (fetch_all) {
          const { items, pages } = await fetchAllPages((p) => gorgiasClient.listSatisfactionSurveys({ ...p, ...filters }));
          return { content: [{ type: "text", text: `${items.length} surveys found (${pages} pages)\n\n${JSON.stringify(items, null, 2)}` }] };
        }
        const params = { limit, ...filters };
        if (cursor) params.cursor = cursor;
        const response = await gorgiasClient.listSatisfactionSurveys(params);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
    { description: "List satisfaction surveys (CSAT data). Set fetch_all=true to get all surveys." }
  );

  // ===== USER/AGENT TOOLS =====

  server.tool(
    "list_users",
    { fetch_all: z.boolean().default(true).describe("true (DEFAULT) = get ALL users. false = single page."), limit: z.number().min(1).max(100).default(30).describe("Results per page"), cursor: z.string().optional().describe("Pagination cursor") },
    async ({ fetch_all, limit, cursor }) => {
      try {
        if (fetch_all) {
          const { items, pages } = await fetchAllPages((p) => gorgiasClient.listUsers(p));
          return { content: [{ type: "text", text: `${items.length} users found (${pages} pages)\n\n${JSON.stringify(items, null, 2)}` }] };
        }
        const params = { limit };
        if (cursor) params.cursor = cursor;
        const response = await gorgiasClient.listUsers(params);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
    { description: "List all users/agents. Auto-paginates by default." }
  );

  server.tool(
    "get_user",
    { id: z.number().describe("User ID") },
    async ({ id }) => {
      try {
        const response = await gorgiasClient.getUser(id);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
    { description: "Get a user/agent by ID" }
  );

  // ===== RULE TOOLS =====

  server.tool(
    "list_rules",
    { fetch_all: z.boolean().default(true).describe("true (DEFAULT) = get ALL rules. false = single page."), limit: z.number().min(1).max(100).default(30).describe("Results per page"), cursor: z.string().optional().describe("Pagination cursor") },
    async ({ fetch_all, limit, cursor }) => {
      try {
        if (fetch_all) {
          const { items, pages } = await fetchAllPages((p) => gorgiasClient.listRules(p));
          return { content: [{ type: "text", text: `${items.length} rules found (${pages} pages)\n\n${JSON.stringify(items, null, 2)}` }] };
        }
        const params = { limit };
        if (cursor) params.cursor = cursor;
        const response = await gorgiasClient.listRules(params);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
    { description: "List all automation rules. Auto-paginates by default (fetch_all=true) to return ALL rules." }
  );

  server.tool(
    "get_rule",
    { id: z.number().describe("Rule ID") },
    async ({ id }) => {
      try {
        const response = await gorgiasClient.getRule(id);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
    { description: "Get a rule by ID" }
  );

  // ===== VIEW TOOLS =====

  server.tool(
    "list_views",
    { fetch_all: z.boolean().default(true).describe("true (DEFAULT) = get ALL views. false = single page."), limit: z.number().min(1).max(100).default(30).describe("Results per page"), cursor: z.string().optional().describe("Pagination cursor") },
    async ({ fetch_all, limit, cursor }) => {
      try {
        if (fetch_all) {
          const { items, pages } = await fetchAllPages((p) => gorgiasClient.listViews(p));
          return { content: [{ type: "text", text: `${items.length} views found (${pages} pages)\n\n${JSON.stringify(items, null, 2)}` }] };
        }
        const params = { limit };
        if (cursor) params.cursor = cursor;
        const response = await gorgiasClient.listViews(params);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
    { description: "List all views. Auto-paginates by default. Key views: 1374210 (Unreplied), 1374209 (Open replied), 1374202 (All open)." }
  );

  server.tool(
    "get_view",
    { id: z.number().describe("View ID") },
    async ({ id }) => {
      try {
        const response = await gorgiasClient.getView(id);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
    { description: "Get a specific view by ID with its filters and configuration" }
  );

  server.tool(
    "get_view_tickets",
    {
      id: z.number().describe("View ID"),
      fetch_all: z.boolean().default(false).describe("true = auto-paginate ALL tickets in view. false (DEFAULT) = single page."),
      limit: z.number().min(1).max(100).default(30).describe("Results per page"),
      cursor: z.string().optional().describe("Pagination cursor (only when fetch_all=false)")
    },
    async ({ id, fetch_all, limit, cursor }) => {
      try {
        if (fetch_all) {
          let allTickets = [];
          let nextCursor = undefined;
          let page = 0;
          const maxPages = 50; // Safety: max 5000 tickets
          do {
            const params = { limit: 100 };
            if (nextCursor) params.cursor = nextCursor;
            const response = await gorgiasClient.getViewTickets(id, params);
            const data = response.data;
            const tickets = data?.data || data || [];
            allTickets = allTickets.concat(tickets);
            nextCursor = data?.meta?.next_cursor || null;
            page++;
          } while (nextCursor && page < maxPages);
          return { content: [{ type: "text", text: `View ${id}: ${allTickets.length} total tickets (${page} pages fetched)\n\n${JSON.stringify(allTickets, null, 2)}` }] };
        } else {
          const params = { limit };
          if (cursor) params.cursor = cursor;
          const response = await gorgiasClient.getViewTickets(id, params);
          return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
        }
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
    { description: "Get tickets in a specific view. Set fetch_all=true to auto-paginate ALL tickets. Key view IDs: 1374210 (Unreplied), 1374209 (Open replied), 1374202 (All open), 1374200 (DF Prime), 1365871 (Claims), 1365869 (ShipBob)." }
  );

  // ===== TICKET MERGE TOOL =====

  server.tool(
    "merge_tickets",
    {
      main_ticket_id: z.number().describe("The ticket ID that will remain (all others merge into this one)"),
      ticket_ids: z.array(z.number()).describe("Array of ticket IDs to merge into the main ticket")
    },
    async ({ main_ticket_id, ticket_ids }) => {
      try {
        const response = await gorgiasClient.mergeTickets(main_ticket_id, ticket_ids);
        return { content: [{ type: "text", text: `Tickets [${ticket_ids.join(', ')}] merged into ticket ${main_ticket_id}` }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
    { description: "Merge multiple tickets into one main ticket. All messages from the merged tickets will appear in the main ticket. The merged tickets will be closed." }
  );

  // ===== SNOOZE TOOLS =====

  server.tool(
    "snooze_ticket",
    {
      id: z.number().describe("Ticket ID to snooze"),
      snooze_datetime: z.string().describe("ISO 8601 datetime when the ticket should un-snooze and reappear (e.g. 2026-03-15T09:00:00Z)")
    },
    async ({ id, snooze_datetime }) => {
      try {
        await gorgiasClient.snoozeTicket(id, snooze_datetime);
        return { content: [{ type: "text", text: `Ticket ${id} snoozed until ${snooze_datetime}` }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
    { description: "Snooze a ticket until a specific date/time. The ticket will disappear from active views and reappear when the snooze expires." }
  );

  server.tool(
    "unsnooze_ticket",
    {
      id: z.number().describe("Ticket ID to unsnooze")
    },
    async ({ id }) => {
      try {
        await gorgiasClient.unsnoozeTicket(id);
        return { content: [{ type: "text", text: `Ticket ${id} unsnoozed — now active again` }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
    { description: "Remove snooze from a ticket, making it active immediately" }
  );

  // ===== RULE CRUD TOOLS =====

  server.tool(
    "create_rule",
    {
      name: z.string().describe("Rule name"),
      description: z.string().optional().describe("Rule description"),
      code: z.string().optional().describe("Rule code/logic as a string. REQUIRED for rules with custom logic (containsAny, script conditions, complex branching). This is the actual rule definition that Gorgias executes. Pass the full rule code as a string."),
      conditions: z.any().optional().describe("Rule conditions (trigger criteria) — structured format. Use 'code' instead for complex logic."),
      actions: z.any().optional().describe("Rule actions (what happens when triggered) — structured format. Use 'code' instead for complex logic."),
      position: z.number().optional().describe("Rule execution order position")
    },
    async (data) => {
      try {
        const response = await gorgiasClient.createRule(data);
        return { content: [{ type: "text", text: `Rule created: ${response.data.name} (ID: ${response.data.id})\nEnabled: ${response.data.enabled}\n${response.data.code ? 'Code: included' : 'Code: none (structured conditions/actions only)'}` }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error creating rule: ${error.message}\n\nTIP: If you get "code: Missing data for required field", you must pass the 'code' parameter with the full rule logic string. Most Gorgias rules require the 'code' field — structured conditions/actions alone are often insufficient.` }], isError: true };
      }
    },
    { description: "Create a new automation rule. For rules with custom logic (containsAny, script conditions), you MUST pass the 'code' field with the full rule definition string. The 'conditions' and 'actions' fields alone are insufficient for complex rules." }
  );

  server.tool(
    "update_rule",
    {
      id: z.number().describe("Rule ID to update"),
      mode: z.enum(["add", "replace"]).default("add").describe("Mode: 'add' (DEFAULT, SAFE) = merges new actions/conditions ON TOP of existing, preserving everything. 'replace' = full replacement (DANGEROUS)."),
      name: z.string().optional().describe("Updated rule name (auto-preserved if omitted)"),
      description: z.string().optional().describe("Updated description (auto-preserved if omitted)"),
      enabled: z.boolean().optional().describe("Enable or disable the rule"),
      code: z.string().optional().describe("Rule code/logic as a string. When provided, REPLACES the entire rule logic regardless of mode. This is the actual rule definition that Gorgias executes."),
      conditions: z.any().optional().describe("Conditions to add/merge (mode=add) or replace entirely (mode=replace). Ignored if 'code' is provided."),
      actions: z.any().optional().describe("Actions to add/merge (mode=add) or replace entirely (mode=replace). Ignored if 'code' is provided."),
      position: z.number().optional().describe("Rule execution order position")
    },
    async ({ id, mode, name, description, enabled, code, conditions, actions, position }) => {
      try {
        // ALWAYS fetch existing rule first — needed for safe merge
        const existingResp = await gorgiasClient.getRule(id);
        const existingData = existingResp.data;
        const existingActions = existingData.actions || [];
        const existingConditions = existingData.conditions || {};

        const ruleData = {};

        // Name & description: preserve existing if not provided
        ruleData.name = name || existingData.name;
        if (description !== undefined) {
          ruleData.description = description;
        } else if (existingData.description) {
          ruleData.description = existingData.description;
        }

        // Enabled: only change if explicitly provided
        if (enabled !== undefined) {
          ruleData.enabled = enabled;
        }

        // Pass through optional fields if provided
        if (position !== undefined) ruleData.position = position;

        // If 'code' is provided, it replaces the entire rule logic — skip conditions/actions merge
        if (code !== undefined) {
          ruleData.code = code;
          await gorgiasClient.updateRule(id, ruleData);
          return { content: [{ type: "text", text: `Rule ${id} updated [CODE REPLACED].\n  Name: ${ruleData.name}\n  Code: updated with new logic` }] };
        }

        let finalActions;
        let finalConditions;
        let modeUsed;

        if (mode === 'replace') {
          // ===== REPLACE MODE: Full replacement (DANGEROUS) =====
          finalActions = actions || existingActions;
          finalConditions = conditions || existingConditions;
          modeUsed = 'REPLACE (full overwrite)';
        } else {
          // ===== ADD MODE (DEFAULT): Merge, never remove =====
          // Actions: append new action types, update existing by name match
          finalActions = [...existingActions];
          if (actions && Array.isArray(actions)) {
            const existingByType = {};
            finalActions.forEach((a, i) => { existingByType[a.type || a.name || i] = i; });
            for (const newAction of actions) {
              const key = newAction.type || newAction.name;
              if (key && existingByType[key] !== undefined) {
                // Update existing action in-place
                finalActions[existingByType[key]] = { ...finalActions[existingByType[key]], ...newAction };
              } else {
                // Append new action
                finalActions.push(newAction);
              }
            }
          }

          // Conditions: deep merge
          finalConditions = { ...existingConditions };
          if (conditions && typeof conditions === 'object') {
            // Merge top-level condition keys
            for (const [key, value] of Object.entries(conditions)) {
              if (Array.isArray(value) && Array.isArray(finalConditions[key])) {
                // Array conditions: append new items, deduplicate by JSON comparison
                const existingJson = new Set(finalConditions[key].map(c => JSON.stringify(c)));
                const merged = [...finalConditions[key]];
                for (const item of value) {
                  if (!existingJson.has(JSON.stringify(item))) {
                    merged.push(item);
                  }
                }
                finalConditions[key] = merged;
              } else {
                finalConditions[key] = value;
              }
            }
          }
          modeUsed = 'ADD (merge, existing preserved)';
        }

        ruleData.actions = finalActions;
        ruleData.conditions = finalConditions;

        await gorgiasClient.updateRule(id, ruleData);

        const actionsBefore = existingActions.map(a => a.type || a.name || 'unknown').join(', ');
        const actionsAfter = finalActions.map(a => a.type || a.name || 'unknown').join(', ');
        return { content: [{ type: "text", text: `Rule ${id} updated [${modeUsed}].\n  Name: ${ruleData.name}\n  Actions before: [${actionsBefore}]\n  Actions after: [${actionsAfter}]\n  Conditions: ${mode === 'replace' ? 'replaced' : 'merged'}` }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
    { description: "Update an automation rule with SAFE MERGE (mode='add' default). Fetches existing rule first, preserves all existing actions/conditions, merges new ones on top. Use mode='replace' ONLY when you explicitly want to overwrite everything. Name and description auto-preserved if omitted." }
  );

  server.tool(
    "delete_rule",
    {
      id: z.number().describe("Rule ID to delete")
    },
    async ({ id }) => {
      try {
        await gorgiasClient.deleteRule(id);
        return { content: [{ type: "text", text: `Rule ${id} deleted` }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
    { description: "Delete an automation rule (CAUTION: irreversible)" }
  );

  // ===== EVENT TOOLS =====

  server.tool(
    "list_events",
    { fetch_all: z.boolean().default(false).describe("true = get ALL events. false (DEFAULT) = single page."), limit: z.number().min(1).max(100).default(30).describe("Results per page"), cursor: z.string().optional().describe("Pagination cursor"), customer_id: z.number().optional().describe("Filter by customer ID"), ticket_id: z.number().optional().describe("Filter by ticket ID") },
    async ({ fetch_all, limit, cursor, ...filters }) => {
      try {
        if (fetch_all) {
          const { items, pages } = await fetchAllPages((p) => gorgiasClient.listEvents({ ...p, ...filters }));
          return { content: [{ type: "text", text: `${items.length} events found (${pages} pages)\n\n${JSON.stringify(items, null, 2)}` }] };
        }
        const params = { limit, ...filters };
        if (cursor) params.cursor = cursor;
        const response = await gorgiasClient.listEvents(params);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
    { description: "List events (ticket activity log) with optional filters. Set fetch_all=true to get all events." }
  );

  // ===== INTEGRATION TOOLS =====

  server.tool(
    "list_integrations",
    { fetch_all: z.boolean().default(true).describe("true (DEFAULT) = get ALL integrations. false = single page."), limit: z.number().min(1).max(100).default(30).describe("Results per page"), cursor: z.string().optional().describe("Pagination cursor") },
    async ({ fetch_all, limit, cursor }) => {
      try {
        if (fetch_all) {
          const { items, pages } = await fetchAllPages((p) => gorgiasClient.listIntegrations(p));
          return { content: [{ type: "text", text: `${items.length} integrations found (${pages} pages)\n\n${JSON.stringify(items, null, 2)}` }] };
        }
        const params = { limit };
        if (cursor) params.cursor = cursor;
        const response = await gorgiasClient.listIntegrations(params);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
    { description: "List all integrations. Auto-paginates by default. Key IDs: 72926/77524/77523 (Main CS), 128936 (DF Prime), 128508 (Claims), 128507 (ShipBob)." }
  );

  // ===== CUSTOM FIELD DEFINITION TOOLS =====

  server.tool(
    "list_custom_fields",
    { object_type: z.enum(["Ticket", "Customer"]).describe("Entity type: 'Ticket' or 'Customer'"), fetch_all: z.boolean().default(true).describe("true (DEFAULT) = get ALL fields. false = single page."), limit: z.number().min(1).max(100).default(30).describe("Results per page"), cursor: z.string().optional().describe("Pagination cursor") },
    async ({ object_type, fetch_all, limit, cursor }) => {
      try {
        if (fetch_all) {
          const { items, pages } = await fetchAllPages((p) => gorgiasClient.listCustomFields({ ...p, object_type }));
          return { content: [{ type: "text", text: `${items.length} ${object_type} custom fields found (${pages} pages)\n\n${JSON.stringify(items, null, 2)}` }] };
        }
        const params = { object_type, limit };
        if (cursor) params.cursor = cursor;
        const response = await gorgiasClient.listCustomFields(params);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
    { description: "List all custom field definitions. MUST specify object_type: 'Ticket' or 'Customer'. Auto-paginates by default." }
  );

  server.tool(
    "get_custom_field",
    { id: z.number().describe("Custom field ID") },
    async ({ id }) => {
      try {
        const response = await gorgiasClient.getCustomField(id);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
    { description: "Get a custom field definition by ID — shows label, type, choices, required status, etc." }
  );

  server.tool(
    "create_custom_field",
    { label: z.string().describe("Field label/name (e.g. 'Contact Reason', 'Defective Item')"), object_type: z.enum(["Ticket", "Customer"]).describe("Entity type: 'Ticket' or 'Customer'"), definition: z.record(z.any()).optional().describe("Field definition with type and settings. E.g. {type: 'dropdown', choices: [{label: 'Size Issue'}, {label: 'Defective'}], default: 'Size Issue'}"), input_settings: z.record(z.any()).optional().describe("Input settings (e.g. {placeholder: 'Select reason'})"), required: z.boolean().optional().describe("Whether this field is required"), priority: z.number().optional().describe("Display order (lower = first)"), description: z.string().optional().describe("Field description") },
    async ({ label, object_type, definition, input_settings, required, priority, description }) => {
      try {
        const data = { label, object_type };
        if (definition) data.definition = definition;
        if (input_settings) data.input_settings = input_settings;
        if (required !== undefined) data.required = required;
        if (priority !== undefined) data.priority = priority;
        if (description) data.description = description;
        const response = await gorgiasClient.createCustomField(data);
        return { content: [{ type: "text", text: `Custom field created: ${response.data.label} (ID: ${response.data.id}, type: ${object_type})` }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
    { description: "Create a new custom field definition. Use object_type='Ticket' for ticket fields like contact reasons. For dropdown fields, pass definition: {type: 'dropdown', choices: [{label: 'Option 1'}, {label: 'Option 2'}]}." }
  );

  server.tool(
    "update_custom_field",
    { id: z.number().describe("Custom field ID"), label: z.string().optional().describe("New label"), definition: z.record(z.any()).optional().describe("Updated field definition (type, choices, default)"), input_settings: z.record(z.any()).optional().describe("Updated input settings"), required: z.boolean().optional().describe("Required status"), priority: z.number().optional().describe("Display order"), description: z.string().optional().describe("Description") },
    async ({ id, ...data }) => {
      try {
        const cleanData = Object.fromEntries(Object.entries(data).filter(([_, v]) => v !== undefined));
        await gorgiasClient.updateCustomField(id, cleanData);
        return { content: [{ type: "text", text: `Custom field ${id} updated` }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
    { description: "Update a custom field definition (label, choices, required status, etc)." }
  );

  server.tool(
    "delete_custom_field",
    { id: z.number().describe("Custom field ID") },
    async ({ id }) => {
      try {
        await gorgiasClient.deleteCustomField(id);
        return { content: [{ type: "text", text: `Custom field ${id} deleted` }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
    { description: "Delete a custom field definition. NOTE: Gorgias may return 405 — custom field deletion is not always supported via API. If blocked, rename the field to '[DELETE ME]' and report for manual deletion." }
  );

  // ===== TICKET CUSTOM FIELD VALUE TOOLS =====

  server.tool(
    "list_ticket_custom_field_values",
    { ticket_id: z.number().describe("Ticket ID") },
    async ({ ticket_id }) => {
      try {
        const response = await gorgiasClient.listTicketCustomFieldValues(ticket_id);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
    { description: "List all custom field values set on a specific ticket (contact reason, etc)." }
  );

  server.tool(
    "update_ticket_custom_field_values",
    { ticket_id: z.number().describe("Ticket ID"), values: z.array(z.object({ field_id: z.number().describe("Custom field ID"), value: z.any().describe("Field value (string for text/dropdown, boolean for checkbox, number for number)") })).describe("Array of {field_id, value} pairs to set") },
    async ({ ticket_id, values }) => {
      try {
        await gorgiasClient.updateTicketCustomFieldValues(ticket_id, values);
        return { content: [{ type: "text", text: `Ticket ${ticket_id} custom fields updated (${values.length} fields)` }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
    { description: "Set custom field values on a ticket. Pass array of {field_id, value}. Use list_custom_fields(object_type='Ticket') first to get field IDs." }
  );

  server.tool(
    "delete_ticket_custom_field_value",
    { ticket_id: z.number().describe("Ticket ID"), field_id: z.number().describe("Custom field ID to clear") },
    async ({ ticket_id, field_id }) => {
      try {
        await gorgiasClient.deleteTicketCustomFieldValue(ticket_id, field_id);
        return { content: [{ type: "text", text: `Custom field ${field_id} cleared from ticket ${ticket_id}` }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
    { description: "Clear/remove a custom field value from a ticket." }
  );

  // ===== CUSTOMER CUSTOM FIELD VALUE TOOLS =====

  server.tool(
    "list_customer_custom_field_values",
    { customer_id: z.number().describe("Customer ID") },
    async ({ customer_id }) => {
      try {
        const response = await gorgiasClient.listCustomerCustomFieldValues(customer_id);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
    { description: "List all custom field values for a customer." }
  );

  server.tool(
    "update_customer_custom_field_value",
    { customer_id: z.number().describe("Customer ID"), field_id: z.number().describe("Custom field ID"), value: z.any().describe("Field value") },
    async ({ customer_id, field_id, value }) => {
      try {
        await gorgiasClient.updateCustomerCustomFieldValue(customer_id, field_id, { value });
        return { content: [{ type: "text", text: `Customer ${customer_id} custom field ${field_id} updated` }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
    { description: "Set a custom field value on a customer." }
  );

  server.tool(
    "delete_customer_custom_field_value",
    { customer_id: z.number().describe("Customer ID"), field_id: z.number().describe("Custom field ID to clear") },
    async ({ customer_id, field_id }) => {
      try {
        await gorgiasClient.deleteCustomerCustomFieldValue(customer_id, field_id);
        return { content: [{ type: "text", text: `Custom field ${field_id} cleared from customer ${customer_id}` }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
    { description: "Clear/remove a custom field value from a customer." }
  );

  // ===== CUSTOM FIELD CONDITIONS =====

  server.tool(
    "list_custom_field_conditions",
    { object_type: z.enum(["Ticket", "Customer"]).describe("Entity type: 'Ticket' or 'Customer'"), fetch_all: z.boolean().default(true).describe("true (DEFAULT) = get ALL conditions. false = single page."), limit: z.number().min(1).max(100).default(30).describe("Results per page"), cursor: z.string().optional().describe("Pagination cursor") },
    async ({ object_type, fetch_all, limit, cursor }) => {
      try {
        if (fetch_all) {
          const { items, pages } = await fetchAllPages((p) => gorgiasClient.listCustomFieldConditions({ ...p, object_type }));
          return { content: [{ type: "text", text: `${items.length} ${object_type} conditions found (${pages} pages)\n\n${JSON.stringify(items, null, 2)}` }] };
        }
        const params = { object_type, limit };
        if (cursor) params.cursor = cursor;
        const response = await gorgiasClient.listCustomFieldConditions(params);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
    { description: "List all custom field conditions (visibility rules, field dependencies). Auto-paginates by default." }
  );

  // ===== ACCOUNT TOOLS =====

  server.tool(
    "get_account",
    {},
    async () => {
      try {
        const response = await gorgiasClient.getAccount();
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
    { description: "Get account information" }
  );

  return server;
}

export { createServer };
