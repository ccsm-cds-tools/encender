import { expect } from 'chai';
import { MapMessageListener, setCqfMessages } from '../src/messageListener.js';

describe('Message Listener tests', () => {
  let listener;
  let recordedMessages;

  describe('MapMessageListener', () => {
    beforeEach(() => {
      listener = new MapMessageListener();
    });

    it('Should record a unique message', () => {
      listener.onMessage({}, 'code1', 'error', 'Test message');
      expect(listener.recordedMessages.size).to.equal(1);
    });

    it('Should not record duplicate messages', () => {
      listener.onMessage({}, 'code1', 'error', 'Test message');
      listener.onMessage({}, 'code1', 'error', 'Test message');
      expect(listener.recordedMessages.size).to.equal(1);
    });

    it('Should record different messages', () => {
      listener.onMessage({}, 'code1', 'error', 'Test message');
      listener.onMessage({}, 'code2', 'warning', 'Another message');
      expect(listener.recordedMessages.size).to.equal(2);
    });
  });

  describe('setCqfMessages', () => {
    beforeEach(() => {
      recordedMessages = new Map();
      listener = new MapMessageListener(recordedMessages);
    });

    it('Should throw an error if the FHIR resource is invalid', () => {
      listener.onMessage({}, 'code1', 'error', 'Test message');
      expect(() => setCqfMessages(recordedMessages, null)).to.throw('Invalid FHIR resource');
    });

    it('Should return the FHIR resource unchanged if no messages are recorded', () => {
      const fhirResource = {resourceType: 'CarePlan'};
      const result = setCqfMessages(recordedMessages, fhirResource);
      expect(result).to.equal(fhirResource);
    });

    it('Should add cqf-messages extension and contained resource', () => {
      listener.onMessage({}, 'code1', 'error', 'Test message');
      const fhirResource = {resourceType: 'CarePlan'};
      const result = setCqfMessages(recordedMessages, fhirResource);
      expect(result.extension).to.be.an('array').that.is.not.empty;
      expect(result.contained).to.be.an('array').that.is.not.empty;
    });

    it('Should return an OperationOutcome resource with recorded messages', () => {
      listener.onMessage({}, 'code1', 'error', 'Test message');
      const fhirResource = {resourceType: 'CarePlan'};
      const result = setCqfMessages(recordedMessages, fhirResource);
      const operationOutcome = result.contained[0];
      expect(operationOutcome.resourceType).to.equal('OperationOutcome');
      expect(operationOutcome.issue).to.be.an('array').that.has.lengthOf(1);
      expect(operationOutcome.issue[0].diagnostics).to.equal('Test message');
    });

    it('Should map severity correctly', () => {
      listener.onMessage({}, 'code1', 'trace', 'Trace message');
      const fhirResource = {resourceType: 'CarePlan'};
      const result = setCqfMessages(recordedMessages, fhirResource);
      const operationOutcome = result.contained[0];
      expect(operationOutcome.issue[0].severity).to.equal('information');
    });

    it('Should return details with coding if code is a valid URI', () => {
      listener.onMessage({}, 'http://example.com/system/code', 'trace', 'Trace message');
      const fhirResource = {resourceType: 'CarePlan'};
      const result = setCqfMessages(recordedMessages, fhirResource);
      const operationOutcome = result.contained[0];
      const details = operationOutcome.issue[0].details;
      expect(details).to.have.property('coding').that.is.an('array');
      expect(details.coding[0]).to.have.property('system', 'http://example.com/system');
      expect(details.coding[0]).to.have.property('code', 'code');
    });

    it('Should return details with text if code is not a URI', () => {
      listener.onMessage({}, 'simpleCode', 'trace', 'Trace message');
      const fhirResource = {resourceType: 'CarePlan'};
      const result = setCqfMessages(recordedMessages, fhirResource);
      const operationOutcome = result.contained[0];
      const details = operationOutcome.issue[0].details;      
      expect(details).to.have.property('text', 'simpleCode');
    });
  });
});
