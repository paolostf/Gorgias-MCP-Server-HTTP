import axios from 'axios';

class GorgiasClient {
  constructor() {
    this.baseURL = null;
    this.auth = null;
  }

  initialize() {
    if (this.baseURL) return;

    const domain = process.env.GORGIAS_DOMAIN;
    if (!domain) {
      throw new Error('GORGIAS_DOMAIN environment variable is required');
    }

    this.baseURL = `https://${domain}/api`;

    if (process.env.GORGIAS_USERNAME && process.env.GORGIAS_API_KEY) {
      this.auth = {
        username: process.env.GORGIAS_USERNAME,
        password: process.env.GORGIAS_API_KEY
      };
    } else if (process.env.GORGIAS_ACCESS_TOKEN) {
      this.auth = null;
      this.accessToken = process.env.GORGIAS_ACCESS_TOKEN;
    } else {
      throw new Error('Either GORGIAS_USERNAME and GORGIAS_API_KEY, or GORGIAS_ACCESS_TOKEN must be provided');
    }
  }

  async request(method, endpoint, data = null, params = null) {
    this.initialize();

    const config = {
      method,
      url: `${this.baseURL}/${endpoint}`,
      headers: { 'Content-Type': 'application/json' }
    };

    if (this.auth) {
      config.auth = this.auth;
    } else if (this.accessToken) {
      config.headers['Authorization'] = `Bearer ${this.accessToken}`;
    }

    if (data) config.data = data;
    if (params) config.params = params;

    try {
      return await axios(config);
    } catch (error) {
      if (error.response) {
        throw new Error(`Gorgias API error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
      }
      throw error;
    }
  }

  // ===== TICKETS =====
  async listTickets(params = {}) { return this.request('GET', 'tickets', null, params); }
  async getTicket(id) { return this.request('GET', `tickets/${id}`); }
  async createTicket(data) { return this.request('POST', 'tickets', data); }
  async updateTicket(id, data) { return this.request('PUT', `tickets/${id}`, data); }
  async deleteTicket(id) { return this.request('DELETE', `tickets/${id}`); }
  async searchTickets(query, params = {}) { return this.request('GET', 'tickets', null, { q: query, ...params }); }

  // ===== MESSAGES =====
  async listMessages(ticketId, params = {}) { return this.request('GET', `tickets/${ticketId}/messages`, null, params); }
  async getMessage(ticketId, messageId) { return this.request('GET', `tickets/${ticketId}/messages/${messageId}`); }
  async addMessageToTicket(ticketId, data) { return this.request('POST', `tickets/${ticketId}/messages`, data); }
  async deleteMessage(ticketId, messageId) { return this.request('DELETE', `tickets/${ticketId}/messages/${messageId}`); }

  // ===== CUSTOMERS =====
  async listCustomers(params = {}) { return this.request('GET', 'customers', null, params); }
  async getCustomer(id) { return this.request('GET', `customers/${id}`); }
  async createCustomer(data) { return this.request('POST', 'customers', data); }
  async updateCustomer(id, data) { return this.request('PUT', `customers/${id}`, data); }

  // ===== TAGS =====
  async listTags(params = {}) { return this.request('GET', 'tags', null, params); }
  async createTag(data) { return this.request('POST', 'tags', data); }
  async addTagToTicket(ticketId, tagId) { return this.request('POST', `tickets/${ticketId}/tags`, { id: tagId }); }
  async removeTagFromTicket(ticketId, tagId) { return this.request('DELETE', `tickets/${ticketId}/tags/${tagId}`); }

  // ===== MACROS =====
  async listMacros(params = {}) { return this.request('GET', 'macros', null, params); }
  async getMacro(id) { return this.request('GET', `macros/${id}`); }
  async createMacro(data) { return this.request('POST', 'macros', data); }
  async updateMacro(id, data) { return this.request('PUT', `macros/${id}`, data); }
  async deleteMacro(id) { return this.request('DELETE', `macros/${id}`); }

  // ===== SATISFACTION SURVEYS =====
  async listSatisfactionSurveys(params = {}) { return this.request('GET', 'satisfaction-surveys', null, params); }

  // ===== USERS/AGENTS =====
  async listUsers(params = {}) { return this.request('GET', 'users', null, params); }
  async getUser(id) { return this.request('GET', `users/${id}`); }

  // ===== RULES =====
  async listRules(params = {}) { return this.request('GET', 'rules', null, params); }
  async getRule(id) { return this.request('GET', `rules/${id}`); }

  // ===== VIEWS =====
  async listViews(params = {}) { return this.request('GET', 'views', null, params); }

  // ===== EVENTS =====
  async listEvents(params = {}) { return this.request('GET', 'events', null, params); }

  // ===== INTEGRATIONS =====
  async listIntegrations(params = {}) { return this.request('GET', 'integrations', null, params); }

  // ===== CUSTOM FIELDS =====
  async listCustomFields(params = {}) { return this.request('GET', 'custom-fields', null, params); }

  // ===== ACCOUNT =====
  async getAccount() { return this.request('GET', 'account'); }
}

export const gorgiasClient = new GorgiasClient();
