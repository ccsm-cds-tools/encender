import chai from 'chai';
import { simpleResolver } from '../src/simpleResolver.js';

chai.should();

describe('Resource resolver tests', function () {

  it('Should allow a new simpleResolver to be created.', function() {
    let resolver = simpleResolver();
    resolver.should.exist;
  });

  it('Should load a JSON file if it exists.', function() {
    let resolver = simpleResolver('./test/fixtures/basic.json');
    let fhirJson = resolver(); // calling with no argument returns everything
    fhirJson.should.deep.equal([
      {
        "resourceType": "Patient",
        "id": "123"
      },
      {
        "resourceType": "Patient",
        "id": "abc"
      },
      {
        "resourceType": "Condition",
        "id": "456",
        "subject": {
          "reference": "Patient/123"
        }
      }
    ]);
  });

  it('Should load a entries in a bundle resource.', function() {
    let resolver = simpleResolver('./test/fixtures/bundle.json');
    let fhirJson = resolver(); // calling with no argument returns everything
    fhirJson.should.deep.equal([
      {
        "resourceType": "Patient",
        "id": "123"
      },
      {
        "resourceType": "Patient",
        "id": "abc"
      },
      {
        "resourceType": "Condition",
        "id": "456",
        "subject": {
          "reference": "Patient/123"
        }
      }
    ]);
  });

  it('Should correctly return the resource we ask for by relative literal reference.', function() {
    // See https://www.hl7.org/fhir/references.html#literal
    let resolver = simpleResolver('./test/fixtures/basic.json');
    let fhirJson = resolver('Patient/123');
    fhirJson.should.deep.equal([{
      "resourceType": "Patient",
      "id": "123"
    }]);
  });

  it('Should correctly resolve absolute references.', function() {
    // See https://www.hl7.org/fhir/references.html#literal
    let resolver = simpleResolver('./test/fixtures/absolute.json');
    let fhirJson = resolver('https://example-fhir-api.com/path/to/fhir/api/Patient/123');
    fhirJson.should.deep.equal([{
      "resourceType": "Patient",
      "id": "123"
    }]);
  });

  it('Should correctly resolve canonical references with a version.', function() {
    // See https://www.hl7.org/fhir/references.html#literal
    let resolver = simpleResolver('./test/fixtures/canonical.json');
    let fhirJson = resolver('https://example-fhir-api.com/path/to/fhir/api/PlanDefinition/789|1.0.0');
    fhirJson.should.deep.equal([{
      "resourceType": "PlanDefinition",
      "id": "789",
      "version": "1.0.0",
      "url": "https://example-fhir-api.com/path/to/fhir/api/PlanDefinition/789"
    }]);
  });

  it('Should pick the latest version of a resource if none is specified.', function() {
    let resolver = simpleResolver('./test/fixtures/canonical.json');
    
    // Relative (literal) reference
    let fhirJson1 = resolver('PlanDefinition/789');
    fhirJson1.should.deep.equal([{
      "resourceType": "PlanDefinition",
      "id": "789",
      "version": "1.1.0",
      "url": "https://example-fhir-api.com/path/to/fhir/api/PlanDefinition/789"
    }]);

    // Absolute reference (could be literal or canonical)
    let fhirJson2 = resolver('https://example-fhir-api.com/path/to/fhir/api/PlanDefinition/789');
    fhirJson2.should.deep.equal([{
      "resourceType": "PlanDefinition",
      "id": "789",
      "version": "1.1.0",
      "url": "https://example-fhir-api.com/path/to/fhir/api/PlanDefinition/789"
    }]);
  });

  it('Should correctly handle duplicate entries.', function() {
    // See https://www.hl7.org/fhir/references.html#literal
    let resolver = simpleResolver('./test/fixtures/duplicate.json');
    let fhirJson = resolver('Patient/123');
    fhirJson.should.deep.equal([{
      "resourceType": "Patient",
      "id": "123"
    }]);
  });

  it('Should not return anything if the specified version is not found.', function() {
    // See https://www.hl7.org/fhir/references.html#literal
    let resolver = simpleResolver('./test/fixtures/canonical.json');
    let fhirJson = resolver('https://example-fhir-api.com/path/to/fhir/api/PlanDefinition/789|2.0.0');
    fhirJson.should.deep.equal([]);
  });

  it('Should not return anything if the specified ID is not found.', function() {
    // See https://www.hl7.org/fhir/references.html#literal
    let resolver = simpleResolver('./test/fixtures/canonical.json');
    let fhirJson = resolver('https://example-fhir-api.com/path/to/fhir/api/PlanDefinition/alphaBetaGamma|1.0.0');
    fhirJson.should.deep.equal([]);
  });

  it('Should not return anything if the specified ID is not found and a version is not requested.', function() {
    // See https://www.hl7.org/fhir/references.html#literal
    let resolver = simpleResolver('./test/fixtures/canonical.json');
    let fhirJson = resolver('https://example-fhir-api.com/path/to/fhir/api/PlanDefinition/alphaBetaGamma');
    fhirJson.should.deep.equal([]);
  });

});