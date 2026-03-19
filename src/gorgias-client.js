class GorgiasClient {
  constructor() {
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;

    this.domain = process.env.GORGIAS_DOMAIN;
    this.username = process.env.GORGIAS_USERNAME;
    this.apiKey = process.env.GORGIAS_API_KEY;

    if (!this.domain || !this.username || !this.apiKey) {
      throw new Error('GORGIAS_DOMAIN, GORGIAS_USERNAME, and GORGIAS_API_KEY environment variables are required');
    }

    this.baseUrl = `https://${this.domain}/api`;
    this.authHeader = 'Basic ' + Buffer.from(`${this.username}:${this.apiKey}`).toString('base64');
    this.initialized = true;
  }

  async request(method, endpoint, data = null, params = null) {
    await this.initialize();

    let url = `${this.baseUrl}/${endpoint}`;
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': this.authHeader,
      },
    };

    if (data) options.body = JSON.stringify(data);
    if (params) {
      const filteredParams = Object.entries(params).filter(([_, v]) => v != null);
      if (filteredParams.length > 0) {
        url += '?' + new URLSearchParams(filteredParams).toString();
      }
    }

    const response = await fetch(url, options);
    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Gorgias API error: ${response.status} - ${errorBody}`);
    }
    return { data: await response.json(), status: response.status };
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
  async addTagToTicket(ticketId, tagId) {
    const ticketResp = await this.getTicket(ticketId);
    const currentTags = ticketResp.data.tags || [];
    const tagIds = currentTags.map(t => ({ id: t.id }));
    if (!tagIds.some(t => t.id === tagId)) {
      tagIds.push({ id: tagId });
    }
    return this.request('PUT', `tickets/${ticketId}`, { tags: tagIds });
  }
  async removeTagFromTicket(ticketId, tagId) {
    const ticketResp = await this.getTicket(ticketId);
    const currentTags = ticketResp.data.tags || [];
    const tagIds = currentTags.filter(t => t.id !== tagId).map(t => ({ id: t.id }));
    return this.request('PUT', `tickets/${ticketId}`, { tags: tagIds });
  }

  // ===== MACROS =====
  async listMacros(params = {}) { return this.request('GET', 'macros', null, params); }
  async getMacro(id) { return this.request('GET', `macros/${id}`); }
  async createMacro(data) { return this.request('POST', 'macros', data); }
  async updateMacro(id, data) { return this.request('PUT', `macros/${id}`, data); }
  async deleteMacro(id) { return this.request('DELETE', `macros/${id}`); }

  // ===== SATISFACTION SURVEYS =====
  async listSatisfactionSurveys(params = {}) { return this.request('GET', 'satisfaction-surveys', null, params); }

  // ===== USERS =====
  async listUsers(params = {}) { return this.request('GET', 'users', null, params); }
  async getUser(id) { return this.request('GET', `users/${id}`); }

  // ===== RULES =====
  async listRules(params = {}) { return this.request('GET', 'rules', null, params); }
  async getRule(id) { return this.request('GET', `rules/${id}`); }
  async createRule(data) { return this.request('POST', 'rules', data); }
  async updateRule(id, data) { return this.request('PUT', `rules/${id}`, data); }
  async deleteRule(id) { return this.request('DELETE', `rules/${id}`); }

  // ===== VIEWS =====
  async listViews(params = {}) { return this.request('GET', 'views', null, params); }
  async getView(id) { return this.request('GET', `views/${id}`); }
  async getViewTickets(id, params = {}) { return this.request('GET', `views/${id}/items`, null, params); }

  // ===== SNOOZE =====
  async snoozeTicket(id, snoozeDatetime) {
    return this.request('PUT', `tickets/${id}`, { snooze_datetime: snoozeDatetime });
  }
  async unsnoozeTicket(id) {
    return this.request('PUT', `tickets/${id}`, { snooze_datetime: null });
  }

  // ===== MERGE =====
  async mergeTickets(mainTicketId, ticketIds) {
    return this.request('POST', `tickets/${mainTicketId}/merge`, { ticket_ids: ticketIds });
  }

  // ===== EVENTS =====
  async listEvents(params = {}) { return this.request('GET', 'events', null, params); }

  // ===== INTEGRATIONS =====
  async listIntegrations(params = {}) { return this.request('GET', 'integrations', null, params); }

  // ===== CUSTOM FIELDS (definitions) =====
  async listCustomFields(params = {}) { return this.request('GET', 'custom-fields', null, params); }
  async getCustomField(id) { return this.request('GET', `custom-fields/${id}`); }
  async createCustomField(data) { return this.request('POST', 'custom-fields', data); }
  async updateCustomField(id, data) { return this.request('PUT', `custom-fields/${id}`, data); }
  async deleteCustomField(id) { return this.request('DELETE', `custom-fields/${id}`); }

  // ===== TICKET CUSTOM FIELD VALUES =====
  async listTicketCustomFieldValues(ticketId) { return this.request('GET', `tickets/${ticketId}/custom-fields`); }
  async updateTicketCustomFieldValues(ticketId, data) { return this.request('PUT', `tickets/${ticketId}/custom-fields`, data); }
  async updateTicketCustomFieldValue(ticketId, fieldId, data) { return this.request('PUT', `tickets/${ticketId}/custom-fields/${fieldId}`, data); }
  async deleteTicketCustomFieldValue(ticketId, fieldId) { return this.request('DELETE', `tickets/${ticketId}/custom-fields/${fieldId}`); }

  // ===== CUSTOMER CUSTOM FIELD VALUES =====
  async listCustomerCustomFieldValues(customerId) { return this.request('GET', `customers/${customerId}/custom-fields`); }
  async updateCustomerCustomFieldValue(customerId, fieldId, data) { return this.request('PUT', `customers/${customerId}/custom-fields/${fieldId}`, data); }
  async deleteCustomerCustomFieldValue(customerId, fieldId) { return this.request('DELETE', `customers/${customerId}/custom-fields/${fieldId}`); }

  // ===== CUSTOM FIELD CONDITIONS =====
  async listCustomFieldConditions(params = {}) { return this.request('GET', 'custom-field-conditions', null, params); }

  // ===== ACCOUNT =====
  async getAccount() { return this.request('GET', 'account'); }
}

export const gorgiasClient = new GorgiasClient();
