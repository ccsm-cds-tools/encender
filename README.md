# Encender
Encender is a software library written in the JavaScript programming language that implements the [`$apply` operation](https://www.hl7.org/fhir/plandefinition.html#12.18.3.3) from the [Fast Healthcare Interoperability Resources (FHIR)](http://hl7.org/fhir/) standard. The `$apply` operation is defined for both [PlanDefinition](https://www.hl7.org/fhir/plandefinition.html) and [ActivityDefinition](https://www.hl7.org/fhir/activitydefinition.html) resources, which are used to describe actions or groups of actions that are general in nature and not specific to any one patient. The name “Encender,” which is also the Spanish word for “to light or turn on,” was chosen for this library because the `$apply` operation takes the patient-agnostic PlanDefinition and ActivityDefinition resources and customizes them in the context of a specific patient's electronic health record. In other words, Encender "applies" FHIR PlanDefinition and ActivityDefinitions resources to a specific patient.

The `$apply` operation is central to how clinical decision support (CDS) can be implemented according to the guidance from the [FHIR Clinical Reasoning Module (CRM)](http://www.hl7.org/fhir/clinicalreasoning-cds-on-fhir.html) as well as the [FHIR Clinical Guidelines Implementation Guide](http://hl7.org/fhir/uv/cpg/). Interoperable CDS with FHIR involves representing the possible CDS actions using a combination of PlanDefinition, ActivityDefinition, and other FHIR resources. Logical [expressions](http://www.hl7.org/fhir/clinicalreasoning-topics-using-expressions.html) are defined which are used to determine which CDS actions apply for a particular patient as well as to customize the actions for said patient. With Encender it is assumed the CDS logic is represented using the [Clinical Quality Language (CQL)](https://cql.hl7.org/). The figure below depicts the `$apply` operation that Encender implements.

![FHIR `$apply` operation as implemented by Encender](fhir-apply.png)

## Installation

Encender has been written for the [NodeJs](https://nodejs.org) JavaScript runtime. It can be installed in an existing project using the [`npm`](https://docs.npmjs.com/) package manager for NodeJs:

```bash
npm install encender
```

### Key Dependencies

* [CQL Worker](https://github.com/asbi-cds-tools/cql-worker) - Used to asynchronously evaluate CQL expressions.
* [CQL Execution Engine](https://github.com/cqframework/cql-execution) - A dependency of CQL Worker.
* [CQL Execution FHIR Data Source](https://github.com/cqframework/cql-exec-fhir) - A dependency of CQL Worker.

## Usage

Once it has been added as a dependency, it can be invoked as follows:

```javascript
import { applyPlan } from 'encender';

// 1. Define planDefinitionObject to hold the JSON representation of the PlanDefinition 
//    resource to be applied.

// 2. Define patientReferenceString for the reference to the Patient resource for 
//    patient to which the PlanDefinition is being applied.

// 3. Define resolver(), a function that takes a FHIR reference and returns matching 
//    FHIR resources.
//    Encender provides simpleResolver(), a function that takes an array of FHIR 
//    resources and returns a resolver() function which can be used with applyPlan().

// 4. Define optional parameters and services and put them in an object called aux.

// **Encender is asynchronous.**
// Calling applyPlan() returns a CarePlan, a RequestGroup, and other FHIR resources.
const [CarePlan, RequestGroup, ...otherResources] = 
  await applyPlan(planDefinitionObject, patientReferenceString, resolver, aux);
```

### Tests and Coverage

The tests folder contains several examples for how to run Encender. Tests can be run at the command line by invoking `npm run test` after running `npm install`. Code test coverage can be calculated by running `npm run coverage`.

## Known Limitations

The following aspects of the `$apply` operation have not been implemented yet:

* [ ] Support for `Goal` resources
* [ ] Support for all `PlanDefinition.action` elements, including timing and start and stop conditions
* [ ] Support for actions that reference `Questionnaire` resources
* [ ] Support for all `ActivityDefinition` elements, including `participant`, `location`, and `transform`.

## License
(C) 2021 The MITRE Corporation. All Rights Reserved. Approved for Public Release: 21-1556. Distribution Unlimited.

Unless otherwise noted, the CCSM CDS is available under an [Apache 2.0 license](./LICENSE.txt). It was produced by the MITRE Corporation for the Division of Cancer Prevention and Control, Centers for Disease Control and Prevention in accordance with the Statement of Work, contract number 75FCMC18D0047, task order number 75D30120F09743.
