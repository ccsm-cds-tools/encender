import { expect } from 'chai';
import { OperationOutcomeMessageListener } from '../src/messageListener.js';

describe('OperationOutcomeMessageListener tests', () => {
  let listener;

  beforeEach(() => {
    listener = new OperationOutcomeMessageListener();
  });

  describe('onMessage', () => {
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
    it('Should throw an error if the FHIR resource is invalid', () => {
      listener.onMessage({}, 'code1', 'error', 'Test message');
      expect(() => listener.setCqfMessages(null)).to.throw('Invalid FHIR resource');
    });

    it('Should return the FHIR resource unchanged if no messages are recorded', () => {
      const fhirResource = {resourceType: 'CarePlan'};
      const result = listener.setCqfMessages(fhirResource);
      expect(result).to.equal(fhirResource);
    });

    it('Should add cqf-messages extension and contained resource', () => {
      listener.onMessage({}, 'code1', 'error', 'Test message');
      const fhirResource = {resourceType: 'CarePlan'};
      const result = listener.setCqfMessages(fhirResource);
      expect(result.extension).to.be.an('array').that.is.not.empty;
      expect(result.contained).to.be.an('array').that.is.not.empty;
    });
  });

  describe('toOperationOutcome', () => {
    it('Should return an OperationOutcome resource with recorded messages', () => {
      listener.onMessage({}, 'code1', 'error', 'Test message');
      const operationOutcome = listener.toOperationOutcome();
      expect(operationOutcome.resourceType).to.equal('OperationOutcome');
      expect(operationOutcome.issue).to.be.an('array').that.has.lengthOf(1);
      expect(operationOutcome.issue[0].diagnostics).to.equal('Test message');
    });

    it('Should map severity correctly', () => {
      listener.onMessage({}, 'code1', 'trace', 'Trace message');
      const operationOutcome = listener.toOperationOutcome();
      expect(operationOutcome.issue[0].severity).to.equal('information');
    });
  });

  describe('codeToDetails', () => {
    it('Should return details with coding if code is a valid URI', () => {
      const details = listener.codeToDetails('http://example.com/system/code');
      expect(details).to.have.property('coding').that.is.an('array');
      expect(details.coding[0]).to.have.property('system', 'http://example.com/system');
      expect(details.coding[0]).to.have.property('code', 'code');
    });

    it('Should return details with text if code is not a URI', () => {
      const details = listener.codeToDetails('simpleCode');
      expect(details).to.have.property('text', 'simpleCode');
    });
  });
});
