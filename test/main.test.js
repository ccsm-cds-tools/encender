import * as chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import  { applyPlan, applyActivity, applyAndMerge } from '../src/main.js'
import { simpleResolver } from '../src/simpleResolver.js';

chai.should();
chai.use(chaiAsPromised);

describe('Basic Conversion Tests', async function() {

  it('Should throw an error if the required arguments are not provided.', async function() {
    let resolver = simpleResolver('./test/fixtures/minimalResources.json');
    const minimalPlanDefinition = resolver('PlanDefinition/minimalPlanDefinition')[0];
    const patientReference = 'Patient/1';

    return Promise.all([

      applyPlan(null, null, null).should.eventually.be.rejected
        .and.be.an.instanceOf(Error)
        .and.have.property('stack')
        .that.includes('One of the following resources must be provided: PlanDefinition, ActivityDefinition'),

      applyPlan(minimalPlanDefinition, null, null).should.eventually.be.rejected
        .and.be.an.instanceOf(Error)
        .and.have.property('stack')
        .that.includes('A Patient reference string must be provided'),

      applyPlan(minimalPlanDefinition, ['stringInsideArray'], null).should.eventually.be.rejected
        .and.be.an.instanceOf(Error)
        .and.have.property('stack')
        .that.includes('A Patient reference string must be provided'),

      applyPlan(minimalPlanDefinition, patientReference, null).should.eventually.be.rejected
        .and.be.an.instanceOf(Error)
        .and.have.property('stack')
        .that.includes('A resource resolver function must be provided'),

      applyPlan(minimalPlanDefinition, patientReference, new Object()).should.eventually.be.rejected
        .and.be.an.instanceOf(Error)
        .and.have.property('stack')
        .that.includes('A resource resolver function must be provided')

    ]);

  });

  it('Should throw an error if the PlanDefinition is not valid and validation was requested.', async function() {
    this.timeout(7500);
    
    let resolver = simpleResolver('./test/fixtures/minimalResources.json');
    const invalidPlanDefinition = resolver('PlanDefinition/invalidPlanDefinition')[0];
    const patientReference = 'Patient/1';

    return applyPlan(invalidPlanDefinition, patientReference, ()=>{}, {validateIncoming: true})
      .should.eventually.be.rejected
      .and.be.an.instanceOf(Error)
      .and.have.property('stack')
      .that.includes('Input is not a valid FHIR resource\nErrors from FHIR JSON Schema Validator: \n\n{\n    "keyword": "additionalProperties",\n    "dataPath": "",\n    "schemaPath": "#/additionalProperties",\n    "params": {\n        "additionalProperty": "statuses"\n    },\n    "message": "should NOT have additional properties"\n}\n{\n    "keyword": "oneOf",\n    "dataPath": "",\n    "schemaPath": "#/oneOf",\n    "params": {\n        "passingSchemas": null\n    },\n    "message": "should match exactly one schema in oneOf"\n}\n\n');

  });

  it('Should throw an error if the patient reference is not resolvable.', async function() {
    let resolver = simpleResolver('./test/fixtures/minimalResources.json');
    const canonicalPlanDefinition = resolver('PlanDefinition/canonicalPlanDefinition')[0];
    const patientReference = 'Patient/1';

    return applyPlan(canonicalPlanDefinition, patientReference, ()=>{}).should.eventually.be.rejected
      .and.be.an.instanceOf(Error)
      .and.have.property('stack')
      .that.includes('Patient reference cannot be resolved');

  });

  it('Should throw an error is the PlanDefinition does not have a canonical url.', async function() {
    let resolver = simpleResolver('./test/fixtures/minimalResources.json');
    const minimalPlanDefinition = resolver('PlanDefinition/minimalPlanDefinition')[0];
    const patientReference = 'Patient/1';

    return applyPlan(minimalPlanDefinition, patientReference, resolver).should.eventually.be.rejected
      .and.be.an.instanceOf(Error)
      .and.have.property('stack')
      .that.includes('Incoming Definition does not have a canonical URL');
    
  });

  it('Should convert a minimal PlanDefinition into a CarePlan.', async function() {
    let resolver = simpleResolver('./test/fixtures/minimalResources.json');
    const canonicalPlanDefinition = resolver('PlanDefinition/canonicalPlanDefinition')[0];
    const patientReference = 'Patient/1';
    
    const [CarePlan, RequestGroup] = await applyPlan(canonicalPlanDefinition, patientReference, resolver);
    
    CarePlan.should.not.be.undefined;
    CarePlan.resourceType.should.equal('CarePlan');
    CarePlan.subject.should.deep.equal({
      reference: 'Patient/1',
      display: ''
    });
    CarePlan.instantiatesCanonical.should.equal('https://example-fhir-api.com/path/to/fhir/api/PlanDefinition/canonicalPlanDefinition');
    CarePlan.status.should.equal('draft');
    CarePlan.intent.should.equal('proposal');
    CarePlan.activity.should.deep.equal([
      {
        reference: { reference: 'RequestGroup/' + RequestGroup.id }
      }
    ]);

    RequestGroup.should.not.be.undefined;
    RequestGroup.resourceType.should.equal('RequestGroup');
    RequestGroup.subject.should.deep.equal({
      reference: 'Patient/1',
      display: ''
    });
    RequestGroup.instantiatesCanonical.should.equal('https://example-fhir-api.com/path/to/fhir/api/PlanDefinition/canonicalPlanDefinition');
    RequestGroup.status.should.equal('draft');
    RequestGroup.intent.should.equal('proposal');

  });

});

describe('More Complex Conversion Tests', async function() {

  it('Should convert a nested PlanDefinition into a nested CarePlan', async function() {
    let resolver = simpleResolver('./test/fixtures/nestedResources.json');
    const nestedPlanDefinition = resolver('PlanDefinition/nestedPlanDefinition')[0];
    const patientReference = 'Patient/1';

    const [CarePlan, RequestGroup, ...otherResources] = await applyPlan(nestedPlanDefinition, patientReference, resolver);

    RequestGroup.action.should.deep.equal([
      {
        id: '5',
        resource: { reference: 'CarePlan/6' }
      }
    ]);

    otherResources.should.deep.equal([
      {
        resourceType: 'CarePlan',
        id: '6',
        subject: { reference: 'Patient/1', display: '' },
        instantiatesCanonical: 'https://example-fhir-api.com/path/to/fhir/api/PlanDefinition/canonicalPlanDefinition',
        intent: 'proposal',
        status: 'option',
        activity: [{
          reference: { reference: 'RequestGroup/7' }
        }]
      },
      {
        resourceType: 'RequestGroup',
        id: '7',
        subject: { reference: 'Patient/1', display: '' },
        instantiatesCanonical: 'https://example-fhir-api.com/path/to/fhir/api/PlanDefinition/canonicalPlanDefinition',
        intent: 'proposal',
        status: 'draft'
      }
    ]);

  });

  it('Should convert groups of actions', async function() {
    let resolver = simpleResolver('./test/fixtures/nestedResources.json');
    const groupActionPlanDefinition = resolver('PlanDefinition/groupActionPlanDefinition')[0];
    const patientReference = 'Patient/1';

    const [CarePlan, RequestGroup, ...otherResources] = await applyPlan(groupActionPlanDefinition, patientReference, resolver);

    RequestGroup.action.should.deep.equal([
      {
        id: '12',
        title: 'I am an action'
      },
      {
        id: '10',
        action: [
          {
            id: '11',
            resource: { reference: 'CarePlan/13' }
          }
        ]
      }
    ]);

    otherResources.should.deep.equal([
      {
        resourceType: 'CarePlan',
        id: '13',
        subject: { reference: 'Patient/1', display: '' },
        instantiatesCanonical: 'https://example-fhir-api.com/path/to/fhir/api/PlanDefinition/canonicalPlanDefinition',
        intent: 'proposal',
        status: 'option',
        activity: [{
          reference: { reference: 'RequestGroup/14' }
        }]
      },
      {
        resourceType: 'RequestGroup',
        id: '14',
        subject: { reference: 'Patient/1', display: '' },
        instantiatesCanonical: 'https://example-fhir-api.com/path/to/fhir/api/PlanDefinition/canonicalPlanDefinition',
        intent: 'proposal',
        status: 'draft'
      }
    ]);

  });

  it('Should convert an action defined by an ActivityDefinition', async function() {
    let resolver = simpleResolver('./test/fixtures/nestedResources.json');
    const planDefinitionWithAnActivity = resolver('PlanDefinition/planDefinitionWithAnActivity')[0];
    const patientReference = 'Patient/1';

    const [CarePlan, RequestGroup, ...otherResources] = await applyPlan(planDefinitionWithAnActivity, patientReference, resolver);

    RequestGroup.action.should.deep.equal([
      {
        id: '17',
        resource: { reference: 'ServiceRequest/18' }
      }
    ]);

    otherResources.should.deep.equal([
      {
        id: '18',
        subject: { reference: 'Patient/1', display: '' },
        resourceType: 'ServiceRequest',
        status: 'option',
        basedOn: [{ "reference": "https://example-fhir-api.com/path/to/fhir/api/ActivityDefinition/hasACode" }],
        code: { 
          coding: [
            {
              system: 'http://snomed.info/sct',
              code: '260385009',
              display: 'Negative'
            }
          ], 
          text: "I'm nothing"
        }
      }
    ]);

  });

  it('Should convert an action defined by a Questionnaire', async function() {
    let resolver = simpleResolver('./test/fixtures/questionnaire.json');
    const planDefinitionWithAnActivity = resolver('PlanDefinition/definitionOfAPlan')[0];
    const patientReference = 'Patient/1';


    const [CarePlan, RequestGroup, ...otherResources] = await applyPlan(planDefinitionWithAnActivity, patientReference, resolver);

    RequestGroup.action.should.deep.equal([
      {
        id: '21',
        resource: { reference: 'Questionnaire/iHaveSomeQuestions' },
        title: 'Questionnaire with a single item with answerOption'
      }
    ]);

    otherResources.should.deep.equal([
      {
        id: 'iHaveSomeQuestions',
        resourceType: 'Questionnaire',
        text: {
          status: 'generated',
          div: '<div xmlns=\"http://www.w3.org/1999/xhtml\">\nTest\n</div>'
        },
        url: 'http://hl7.org/fhir/Questionnaire/1',
        title: 'Questionnaire with a single item with answerOption',
        status: 'draft',
        subjectType: [
          'Patient'
        ],
        date: '2020-03',
        item: [
          {
            linkId: '1',
            text: 'Here is a multiple choice question',
            type: 'choice',
            answerOption: [
              {
                'valueString': 'First choice'
              },
              {
                'valueString': 'Second choice'
              },
              {
                'valueString': 'Third choice'
              }
            ]
          }
        ]
      }
    ]);

  });

});

describe('ActivityDefinition Tests', async function() {

  it('Should convert a simple standalone ActivityDefinition', async function() {
    let resolver = simpleResolver('./test/fixtures/activityResources.json');
    const simpleActivity = resolver('ActivityDefinition/simpleActivity')[0];
    const patientReference = 'Patient/1';

    const targetResource = await applyActivity(simpleActivity, patientReference, resolver);

    targetResource.resourceType.should.equal('ServiceRequest');

  });

  it('Should throw an error if the ActivityDefinition does not specify a kind of resource to create', async function() {
    let resolver = simpleResolver('./test/fixtures/activityResources.json');
    const noKindOfActivity = resolver('ActivityDefinition/noKindOfActivity')[0];
    const patientReference = 'Patient/1';

    return applyActivity(noKindOfActivity, patientReference, resolver).should.eventually.be.rejected
      .and.be.an.instanceOf(Error)
      .and.have.property('stack')
      .that.includes('ActivityDefinition.kind must be one of the following resources: Appointment, AppointmentResponse, CarePlan, Claim, CommunicationRequest, Contract, DeviceRequest, EnrollmentRequest, ImmunizationRecommendation, MedicationRequest, NutritionOrder, ServiceRequest, SupplyRequest, Task, VisionPrescription');

  });

  it('Should throw an error if ActivityDefinition.kind specifies an invalid resource type', async function() {
    let resolver = simpleResolver('./test/fixtures/activityResources.json');
    const invalidKind = resolver('ActivityDefinition/invalidKind')[0];
    const patientReference = 'Patient/1';

    return applyActivity(invalidKind, patientReference, resolver).should.eventually.be.rejected
      .and.be.an.instanceOf(Error)
      .and.have.property('stack')
      .that.includes('ActivityDefinition.kind must be one of the following resources: Appointment, AppointmentResponse, CarePlan, Claim, CommunicationRequest, Contract, DeviceRequest, EnrollmentRequest, ImmunizationRecommendation, MedicationRequest, NutritionOrder, ServiceRequest, SupplyRequest, Task, VisionPrescription');

  });

  it('Should copy over structural elements into the target resource', async function() {
    let resolver = simpleResolver('./test/fixtures/activityResources.json');
    const hasACode = resolver('ActivityDefinition/hasACode')[0];
    const patientReference = 'Patient/1';

    const targetResource = await applyActivity(hasACode, patientReference, resolver);

    targetResource.code.should.deep.equal({
      coding: [
        {
          system: 'http://snomed.info/sct',
          code: '260385009',
          display: 'Negative'
        }
      ],
      text: 'I\'m nothing'
    });

  });

});

describe('CQL expression tests', async function() {

  it('Should execute a CQL expression to evaulate an applicability condition (true)', async function() {
    let resolver = simpleResolver('./test/fixtures/applicabilityConditionResources.json');
    const truthyApplicabilityCondition = resolver('PlanDefinition/truthyApplicabilityCondition')[0];
    const patientReference = 'Patient/1';
    const [CarePlan, RequestGroup, ...otherResources] = await applyPlan(truthyApplicabilityCondition, patientReference, resolver);

    RequestGroup.action.should.deep.equal([
      {
        id: '30',
        title: 'I am an unconditional action'
      },
      {
        title: 'I am a conditional action',
        id: '28',
        action: [
          {
            id: '29',
            resource: { reference: 'CarePlan/31' }
          }
        ]
      }
    ]);

  });

  it('Should execute a CQL expression to evaulate an applicability condition (false)', async function() {
    let resolver = simpleResolver('./test/fixtures/applicabilityConditionResources.json');
    const falsyApplicabilityCondition = resolver('PlanDefinition/falsyApplicabilityCondition')[0];
    const patientReference = 'Patient/1';

    const [CarePlan, RequestGroup, ...otherResources] = await applyPlan(falsyApplicabilityCondition, patientReference, resolver);

    RequestGroup.action.should.deep.equal([
      {
        id: '36',
        title: 'I am an unconditional action'
      }
    ]);

  });

  it('Should execute two CQL expressions to evaulate two applicability conditions (true && false = false)', async function() {
    let resolver = simpleResolver('./test/fixtures/applicabilityConditionResources.json');
    const trueFalseApplicabilityConditions = resolver('PlanDefinition/trueFalseApplicabilityConditions')[0];
    const patientReference = 'Patient/1';

    const [CarePlan, RequestGroup, ...otherResources] = await applyPlan(trueFalseApplicabilityConditions, patientReference, resolver);

    RequestGroup.action.should.deep.equal([
      {
        id: '40',
        title: 'I am an unconditional action'
      }
    ]);

  });

  it('Should execute two CQL expressions to evaulate two applicability conditions (true && true = true)', async function() {
    let resolver = simpleResolver('./test/fixtures/applicabilityConditionResources.json');
    const trueTrueApplicabilityConditions = resolver('PlanDefinition/trueTrueApplicabilityConditions')[0];
    const patientReference = 'Patient/1';

    const [CarePlan, RequestGroup, ...otherResources] = await applyPlan(trueTrueApplicabilityConditions, patientReference, resolver);

    // console.log(RequestGroup);

    RequestGroup.action.should.deep.equal([
      {
        id: '45',
        title: 'I am an unconditional action'
      },
      {
        title: 'I am a conditional action',
        id: '43',
        action: [
          {
            id: '44',
            resource: { reference: 'CarePlan/46' }
          }
        ]
      }
    ]);

  });

  it('Should execute ten CQL expressions to evaulate ten applicability conditions (all true)', async function() {
    let resolver = simpleResolver('./test/fixtures/applicabilityConditionResources.json');
    const tenApplicabilityConditions = resolver('PlanDefinition/tenApplicabilityConditions')[0];
    const patientReference = 'Patient/1';

    const [CarePlan, RequestGroup, ...otherResources] = await applyPlan(tenApplicabilityConditions, patientReference, resolver);

    RequestGroup.action.should.deep.equal([
      {
        id: '51',
        title: 'I am an unconditional action'
      }
    ]);

  });

  it('Should evaluate dynamicValue elements on an action', async function() {
    let resolver = simpleResolver('./test/fixtures/dynamicValuesResources.json');
    const hasDynamicValueAction = resolver('PlanDefinition/hasDynamicValueAction')[0];
    const patientReference = 'Patient/1';

    const [CarePlan, RequestGroup, ...otherResources] = await applyPlan(hasDynamicValueAction, patientReference, resolver);

    RequestGroup.action.should.deep.equal([
      {
        id: '56',
        title: 'I am an unconditional action'
      },
      {
        title: 'I am a conditional action',
        id: '54',
        action: [
          {
            id: '55',
            resource: { reference: 'ServiceRequest/57' }
          }
        ]
      }
    ]);

    otherResources.should.deep.equal([
      {
        id: '57',
        subject: { reference: 'Patient/1', display: '' },
        resourceType: 'ServiceRequest',
        status: 'option',
        basedOn: [{ "reference": "https://example-fhir-api.com/path/to/fhir/api/ActivityDefinition/hasACode" }],
        code: { 
          coding: [{
            code: '10828004',
            display: 'Positive',
            system: 'http://snomed.info/sct'
          }], 
          text: 'I\'m something' 
        }
      }
    ]);

  });

  it('Should stringify dynamicValue elements with paths that end with ofType(string).', async function() {
    let resolver = simpleResolver('./test/fixtures/dynamicValuesResources.json');
    const hasDynamicValueAction = resolver('PlanDefinition/hasDynamicValueThatShouldBeStringified')[0];
    const patientReference = 'Patient/1';

    const [CarePlan, RequestGroup, ...otherResources] = await applyPlan(hasDynamicValueAction, patientReference, resolver);

    RequestGroup.action.should.deep.equal([
      {
        id: '62',
        title: 'I am an unconditional action'
      },
      {
        title: 'I am a conditional action',
        id: '60',
        action: [
          {
            id: '61',
            resource: { reference: 'CommunicationRequest/63' }
          }
        ]
      }
    ]);

    otherResources.should.deep.equal([
      {
        id: '63',
        subject: { reference: 'Patient/1', display: '' },
        resourceType: 'CommunicationRequest',
        status: 'option',
        basedOn: [{ "reference": "https://example-fhir-api.com/path/to/fhir/api/ActivityDefinition/communicateString" }],
        payload: [
          {
            contentString: "{\"coding\":[{\"system\":\"http://snomed.info/sct\",\"code\":\"10828004\",\"display\":\"Positive\"}],\"text\":\"I'm something\"}"
          }
        ]
      }
    ]);

  });

  // TODO: Metadata and precedence rules

});

describe('Asynchronous tests', async function() {
  it('Should wait for a slow resolver before applying.', async function() {
    this.timeout(7500);

    let resolver = simpleResolver('./test/fixtures/minimalResources.json');
    const canonicalPlanDefinition = resolver('PlanDefinition/canonicalPlanDefinition')[0];
    const patientReference = 'Patient/1';

    const slowResolver = (r) => {
      return new Promise((resolve) => setTimeout(() => resolve(resolver(r)), 5000))
    }

    const [CarePlan, RequestGroup] = await applyPlan(canonicalPlanDefinition, patientReference, slowResolver);
    
    CarePlan.should.not.be.undefined;
    CarePlan.resourceType.should.equal('CarePlan');
    CarePlan.subject.should.deep.equal({
      reference: 'Patient/1',
      display: ''
    });
    CarePlan.instantiatesCanonical.should.equal('https://example-fhir-api.com/path/to/fhir/api/PlanDefinition/canonicalPlanDefinition');
    CarePlan.status.should.equal('draft');
    CarePlan.intent.should.equal('proposal');
    CarePlan.activity.should.deep.equal([
      {
        reference: { reference: 'RequestGroup/' + RequestGroup.id }
      }
    ]);

    RequestGroup.should.not.be.undefined;
    RequestGroup.resourceType.should.equal('RequestGroup');
    RequestGroup.subject.should.deep.equal({
      reference: 'Patient/1',
      display: ''
    });
    RequestGroup.instantiatesCanonical.should.equal('https://example-fhir-api.com/path/to/fhir/api/PlanDefinition/canonicalPlanDefinition');
    RequestGroup.status.should.equal('draft');
    RequestGroup.intent.should.equal('proposal');

  });
});

describe('Merge Nested Actions Tests', async function() {

  it('Should merge the actions in a simple nested PlanDefinition.', async function() {
    let resolver = simpleResolver('./test/fixtures/nestedResources.json');
    const nestedPlanDefinition = resolver('PlanDefinition/nestedPlanDefinitionWithActivity')[0];
    const patientReference = 'Patient/1';

    const [RequestGroup, ...otherResources] = await applyAndMerge(nestedPlanDefinition, patientReference, resolver);

    RequestGroup.should.deep.equal(
      {
        resourceType: 'RequestGroup',
        id: '67',
        subject: { reference: 'Patient/1', display: '' },
        instantiatesCanonical: 'https://example-fhir-api.com/path/to/fhir/api/PlanDefinition/nestedPlanDefinitionWithActivity',
        intent: 'proposal',
        status: 'draft',
        action: [
          {
            id: '71',
            resource: {
              reference: 'ServiceRequest/72'
            }
          }
        ]
      }
    );

    otherResources.should.deep.equal([
      {
        resourceType: 'ServiceRequest',
        id: '72',
        subject: {
          display: '',
          reference: 'Patient/1'
        },
        status: 'option',
        basedOn: [{
          reference: 'https://example-fhir-api.com/path/to/fhir/api/ActivityDefinition/hasACode'
        }],
        code: {
          coding: [
            {
              code: '260385009',
              display: 'Negative',
              system: 'http://snomed.info/sct',
            }
          ],
          text: 'I\'m nothing'
        }
      }
    ]);

  });

});

describe('ActivityDefinition.kind Tests', async function() {

  it('Should copy over the correct structural elements for a ServiceRequest', async function() {
    let resolver = simpleResolver('./test/fixtures/activityResources.json');
    const serviceReqAD = resolver('ActivityDefinition/kindIsServiceRequest')[0];
    const patientReference = 'Patient/1';

    const targetResource = await applyActivity(serviceReqAD, patientReference, resolver);

    targetResource.subject.reference.should.equal(patientReference);
    targetResource.intent.should.equal(serviceReqAD.intent);
    targetResource.code.should.deep.equal(serviceReqAD.code);
    targetResource.bodySite.should.deep.equal(serviceReqAD.bodySite);

  });

  it('Should copy over the correct structural elements for a MedicationRequest', async function() {
    let resolver = simpleResolver('./test/fixtures/activityResources.json');
    const medicationReqAD = resolver('ActivityDefinition/kindIsMedicationRequest')[0];
    const patientReference = 'Patient/1';

    const targetResource = await applyActivity(medicationReqAD, patientReference, resolver);

    targetResource.priority.should.equal(medicationReqAD.priority);
    targetResource.dosageInstruction.should.deep.equal(medicationReqAD.dosage);
    targetResource.medicationCodeableConcept.should.deep.equal(medicationReqAD.productCodeableConcept);

  });

  it('Should copy over the correct structural elements for a SupplyRequest', async function() {
    let resolver = simpleResolver('./test/fixtures/activityResources.json');
    const supplyReqAD = resolver('ActivityDefinition/kindIsSupplyRequest')[0];
    const patientReference = 'Patient/1';

    const targetResource = await applyActivity(supplyReqAD, patientReference, resolver);

    targetResource.quantity.should.deep.equal(supplyReqAD.quantity);
    targetResource.itemCodeableConcept.should.deep.equal(supplyReqAD.code);

  });

  it('Should copy over the correct structural elements for a CommunicationRequest', async function() {
    let resolver = simpleResolver('./test/fixtures/activityResources.json');
    const communicationReqAD = resolver('ActivityDefinition/kindIsCommunicationRequest')[0];
    const patientReference = 'Patient/1';

    const targetResource = await applyActivity(communicationReqAD, patientReference, resolver);

    targetResource.payload.should.have.deep.members([
      {
        "contentString": "I'm nothing"
      },
      {
        "contentAttachment": {
            "url": "https://example.com/exampleDocumentationSite.html",
            "title": "Documentation"
        }
      },
      {
        "contentAttachment": {
            "url": "https://example.com/exampleJustificationSite.html",
            "title": "Justification"
        }
      }
    ]);

  });

  it('Should copy over the correct structural elements for a Task', async function() {
    let resolver = simpleResolver('./test/fixtures/activityResources.json');
    const taskAD = resolver('ActivityDefinition/kindIsTask')[0];
    const patientReference = 'Patient/1';

    const targetResource = await applyActivity(taskAD, patientReference, resolver);

    targetResource.for.reference.should.equal(patientReference);
    targetResource.input.should.have.deep.members([
      {
        "type": taskAD.code,
        "valueAttachment": {
          "url": "https://example.com/exampleDocumentationSite.html",
          "title": "Documentation"
        }
      },
      {
        "type": taskAD.code,
        "valueAttachment": {
          "url": "https://example.com/exampleJustificationSite.html",
          "title": "Justification"
        }
      },
    ]);

  });

  it('Should copy over the correct structural elements for a Task with a cpg-collectwith extension', async function() {
    let resolver = simpleResolver('./test/fixtures/activityResources.json');
    const taskAD = resolver('ActivityDefinition/kindIsTaskWithCpgCollectWith')[0];
    const patientReference = 'Patient/1';

    const targetResource = await applyActivity(taskAD, patientReference, resolver);

    targetResource.for.reference.should.equal(patientReference);
    targetResource.input.should.have.deep.members([
      {
        "type": taskAD.code,
        "valueCanonical": "https://example-fhir-api.com/path/to/fhir/api/exampleQuestionnaire"
      }
    ]);

  });

});