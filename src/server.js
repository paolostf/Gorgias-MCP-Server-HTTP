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
    { limit: z.number().min(1).max(100).default(10).describe("Number of tickets"), page: z.number().min(1).default(1).describe("Page number"), order_by: z.string().optional().describe("Field to order by"), order_dir: z.enum(["asc", "desc"]).optional().describe("Order direction"), status: z.string().optional().describe("Filter by status (open, closed)"), assignee_user_id: z.number().optional().describe("Filter by assignee user ID"), customer_id: z.number().optional().describe("Filter by customer ID"), channel: z.string().optional().describe("Filter by channel"), tag_id: z.number().optional().describe("Filter by tag ID") },
    async (params) => {
      try {
        const response = await gorgiasClient.listTickets(params);
        return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
    { description: "List tickets from Gorgias with optional filters" }
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
    { description: "Get a specific ticket by ID" }
  );

  server.tool(
    "create_ticket",
    { subject: z.string().describe("Ticket subject"), message: z.string().describe("Message body text"), customer_email: z.string().email().describe("Customer email"), channel: z.string().default("api").describe("Channel"), via: z.string().default("api").describe("Via source") },
    async ({ subject, message, customer_email, channel, via }) => {
      try {
        const response = await gorgiasClient.createTicket({ subject, message: { content: { text: message } }, customer: { email: customer_email }, channel, via });
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
    { query: z.string().describe("Search query"), limit: z.number().min(1).max(100).default(10).describe("Results per page"), page: z.number().min(1).default(1).describe("Page") },
    async ({ query, limit, page }) => {
      try {
        const response = await gorgiasClient.searchTickets(query, { limit, page });
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
    { ticket_id: z.number().describe("Ticket ID"), limit: z.number().min(1).max(100).default(20).describe("Results per page"), page: z.number().min(1).default(1).describe("Page") },
    async ({ ticket_id, limit, page }) => {
      try {
        const response = await gorgiasClient.listMessages(ticket_id, { limit, page });
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
    { ticket_id: z.number().describe("Ticket ID"), message: z.string().describe("Message body text"), sender_type: z.enum(["customer", "agent"]).default("agent").describe("Sender type"), via: z.string().optional().describe("Via source"), channel: z.string().optional().describe("Channel") },
    async ({ ticket_id, message, sender_type, via, channel }) => {
      try {
        const messageData = { content: { text: message }, sender: { type: sender_type } };
        if (via) messageData.via = via;
        if (channel) messageData.channel = channel;
        await gorgiasClient.addMessageToTicket(ticket_id, messageData);
        return { content: [{ type: "text", text: `Message added to ticket ${ticket_id}` }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
    { description: "Add a message with full body to a ticket" }
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
    { limit: z.number().min(1).max(100).default(10).describe("Results per page"), page: z.number().min(1).default(1).describe("Page"), email: z.string().email().optional().describe("Filter by email") },
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
    { limit: z.number().min(1).max(100).default(20).describe("Results per page"), page: z.number().min(1).default(1).describe("Page") },
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
    { limit: z.number().min(1).max(100).default(20).describe("Results per page"), page: z.number().min(1).default(1).describe("Page") },
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

  // ===== SATISFACTION SURVEY TOOLS =====

  server.tool(
    "list_satisfaction_surveys",
    { limit: z.number().min(1).max(100).default(20).describe("Results per page"), page: z.number().min(1).default(1).describe("Page"), ticket_id: z.number().optional().describe("Filter by ticket ID") },
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
    { limit: z.number().min(1).max(100).default(20).describe("Results per page"), page: z.number().min(1).default(1).describe("Page") },
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
    { limit: z.number().min(1).max(100).default(20).describe("Results per page"), page: z.number().min(1).default(1).describe("Page") },
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
    { limit: z.number().min(1).max(100).default(20).describe("Results per page"), page: z.number().min(1).default(1).describe("Page") },
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

  // ===== EVENT TOOLS =====

  server.tool(
    "list_events",
    { limit: z.number().min(1).max(100).default(20).describe("Results per page"), page: z.number().min(1).default(1).describe("Page"), customer_id: z.number().optional().describe("Filter by customer ID"), ticket_id: z.number().optional().describe("Filter by ticket ID") },
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
    { limit: z.number().min(1).max(100).default(20).describe("Results per page"), page: z.number().min(1).default(1).describe("Page") },
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
    { limit: z.number().min(1).max(100).default(20).describe("Results per page"), page: z.number().min(1).default(1).describe("Page") },
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
