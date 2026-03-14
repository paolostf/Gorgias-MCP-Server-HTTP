import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { gorgiasClient } from './gorgias-client.js';

function createServer() {
  const server = new McpServer({
    name: "Gorgias API",
    version: "1.0.0",
    description: "MCP server for interacting with the Gorgias helpdesk API"
  });

  // ===== TICKET TOOLS =====

  server.tool(
    "list_tickets",
    { limit: z.number().min(1).max(100).default(10).describe("Number of tickets per page"), cursor: z.string().optional().describe("Pagination cursor from previous response"), order_by: z.string().optional().describe("Field to order by (e.g. created_datetime)"), order_dir: z.enum(["asc", "desc"]).optional().describe("Order direction"), status: z.string().optional().describe("Filter by status (open, closed)"), assignee_user_id: z.number().optional().describe("Filter by assignee user ID"), customer_id: z.number().optional().describe("Filter by customer ID"), channel: z.string().optional().describe("Filter by channel"), tag_id: z.number().optional().describe("Filter by tag ID") },
    async (params) => {
      try {
        const response = await gorgiasClient.listTickets(params);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
    { description: "List tickets from Gorgias with optional filters. Use cursor from previous response for pagination." }
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
          subject,
          channel,
          via,
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
    { description: "Delete a ticket" }
  );

  server.tool(
    "search_tickets",
    { query: z.string().describe("Search query"), limit: z.number().min(1).max(100).default(10).describe("Results per page"), cursor: z.string().optional().describe("Pagination cursor") },
    async (params) => {
      try {
        const { query, ...rest } = params;
        const response = await gorgiasClient.searchTickets(query, rest);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
    { description: "Search tickets by query string" }
  );

  // ===== MESSAGE TOOLS =====

  server.tool(
    "list_messages",
    { ticket_id: z.number().describe("Ticket ID"), limit: z.number().min(1).max(100).default(20).describe("Results per page"), cursor: z.string().optional().describe("Pagination cursor") },
    async ({ ticket_id, ...params }) => {
      try {
        const response = await gorgiasClient.listMessages(ticket_id, params);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
    { description: "List all messages for a ticket" }
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
          if (customer?.email) {
            recipientAddress = customer.email;
          }
        }
        const messageData = {
          body_text,
          from_agent,
          channel,
          via,
          source: {
            from: { address: from_address },
          }
        };
        if (recipientAddress) messageData.source.to = [{ address: recipientAddress }];
        if (body_html) messageData.body_html = body_html;
        if (attachments && attachments.length > 0) messageData.attachments = attachments;
        await gorgiasClient.addMessageToTicket(ticket_id, messageData);
        return { content: [{ type: "text", text: `Message added to ticket ${ticket_id} (sent to ${recipientAddress || 'N/A'})${attachments ? ` with ${attachments.length} attachment(s)` : ''}` }] };
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
    { description: "Delete a message from a ticket" }
  );

  // ===== CUSTOMER TOOLS =====

  server.tool(
    "list_customers",
    { limit: z.number().min(1).max(100).default(10).describe("Results per page"), cursor: z.string().optional().describe("Pagination cursor"), email: z.string().email().optional().describe("Filter by email") },
    async (params) => {
      try {
        const response = await gorgiasClient.listCustomers(params);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
    { description: "List customers with optional email filter" }
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
    { limit: z.number().min(1).max(100).default(30).describe("Results per page"), cursor: z.string().optional().describe("Pagination cursor"), order_by: z.string().optional().describe("Field to order by") },
    async (params) => {
      try {
        const response = await gorgiasClient.listTags(params);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
    { description: "List all tags" }
  );

  server.tool(
    "create_tag",
    { name: z.string().describe("Tag name") },
    async (data) => {
      try {
        const response = await gorgiasClient.createTag(data);
        return { content: [{ type: "text", text: `Tag created: ${response.data.name} (ID: ${response.data.id})` }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
    { description: "Create a new tag" }
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
    { limit: z.number().min(1).max(100).default(20).describe("Results per page"), cursor: z.string().optional().describe("Pagination cursor") },
    async (params) => {
      try {
        const response = await gorgiasClient.listMacros(params);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
    { description: "List all macros (saved replies/templates)" }
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
    { name: z.string().describe("Macro name"), body_text: z.string().optional().describe("Macro body plain text"), body_html: z.string().optional().describe("Macro body HTML"), actions: z.array(z.object({ name: z.string(), value: z.any() })).optional().describe("Macro actions array (e.g. set status, add tag)"), attachments: z.array(z.object({ url: z.string(), name: z.string(), content_type: z.string() })).optional().describe("File attachments with url, name, content_type") },
    async (data) => {
      try {
        const response = await gorgiasClient.createMacro(data);
        return { content: [{ type: "text", text: `Macro created: ${response.data.name} (ID: ${response.data.id})` }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
    { description: "Create a new macro with name, body text/HTML, actions, and optional file attachments" }
  );

  server.tool(
    "update_macro",
    { id: z.number().describe("Macro ID"), name: z.string().optional().describe("Macro name"), body_text: z.string().optional().describe("Macro body plain text"), body_html: z.string().optional().describe("Macro body HTML"), actions: z.array(z.object({ name: z.string(), value: z.any() })).optional().describe("Macro actions array"), attachments: z.array(z.object({ url: z.string(), name: z.string(), content_type: z.string() })).optional().describe("File attachments") },
    async ({ id, ...data }) => {
      try {
        await gorgiasClient.updateMacro(id, data);
        return { content: [{ type: "text", text: `Macro ${id} updated` }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
    { description: "Update an existing macro" }
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
    { description: "Delete a macro" }
  );

  // ===== SATISFACTION SURVEY TOOLS =====

  server.tool(
    "list_satisfaction_surveys",
    { limit: z.number().min(1).max(100).default(20).describe("Results per page"), cursor: z.string().optional().describe("Pagination cursor"), ticket_id: z.number().optional().describe("Filter by ticket ID") },
    async (params) => {
      try {
        const response = await gorgiasClient.listSatisfactionSurveys(params);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
    { description: "List satisfaction surveys" }
  );

  // ===== USER/AGENT TOOLS =====

  server.tool(
    "list_users",
    { limit: z.number().min(1).max(100).default(20).describe("Results per page"), cursor: z.string().optional().describe("Pagination cursor") },
    async (params) => {
      try {
        const response = await gorgiasClient.listUsers(params);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
    { description: "List all users/agents" }
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
    { limit: z.number().min(1).max(100).default(20).describe("Results per page"), cursor: z.string().optional().describe("Pagination cursor") },
    async (params) => {
      try {
        const response = await gorgiasClient.listRules(params);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
    { description: "List all automation rules" }
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
    { limit: z.number().min(1).max(100).default(20).describe("Results per page"), cursor: z.string().optional().describe("Pagination cursor") },
    async (params) => {
      try {
        const response = await gorgiasClient.listViews(params);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
    { description: "List all views" }
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
    { id: z.number().describe("View ID"), limit: z.number().min(1).max(100).default(20).describe("Results per page"), cursor: z.string().optional().describe("Pagination cursor") },
    async ({ id, ...params }) => {
      try {
        const response = await gorgiasClient.getViewTickets(id, params);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
    { description: "Get all tickets in a specific view. Use list_views first to find view IDs, then use this to see the same ticket queues your team sees in the Gorgias UI." }
  );

  // ===== EVENT TOOLS =====

  server.tool(
    "list_events",
    { limit: z.number().min(1).max(100).default(20).describe("Results per page"), cursor: z.string().optional().describe("Pagination cursor"), customer_id: z.number().optional().describe("Filter by customer ID"), ticket_id: z.number().optional().describe("Filter by ticket ID") },
    async (params) => {
      try {
        const response = await gorgiasClient.listEvents(params);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
    { description: "List events with optional filters" }
  );

  // ===== INTEGRATION TOOLS =====

  server.tool(
    "list_integrations",
    { limit: z.number().min(1).max(100).default(20).describe("Results per page"), cursor: z.string().optional().describe("Pagination cursor") },
    async (params) => {
      try {
        const response = await gorgiasClient.listIntegrations(params);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
    { description: "List all integrations" }
  );

  // ===== CUSTOM FIELD TOOLS =====

  server.tool(
    "list_custom_fields",
    { limit: z.number().min(1).max(100).default(20).describe("Results per page"), cursor: z.string().optional().describe("Pagination cursor") },
    async (params) => {
      try {
        const response = await gorgiasClient.listCustomFields(params);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
    { description: "List all custom fields" }
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
