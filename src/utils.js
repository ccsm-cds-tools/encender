// A simple generator function to provide temporary IDs for generated resources.
function* simpleGenerator() {
  let n = 1;
  while (true)
    yield n++;
}

let simpleCounter = simpleGenerator();

export function getIncrementalId() {
  return simpleCounter.next().value.toString();
}

// Removes null elements from an object.
export function pruneNull(obj) {
  if (Array.isArray(obj)) {
    return obj.filter(item => item != null).map(pruneNull);
  } else if (typeof obj == 'object') {
    return Object.keys(obj).reduce((acc,key) => {
      const val = pruneNull(obj[key]);
      if (val != null) acc[key] = val;
      return acc;
    }, {});
  }
  return obj;
}

// For parsing patient names.
export function parseName(names) {
  let name = '';
  if (Array.isArray(names)) {
    name = names.reduce((acc, cv) => {
      if (acc == '') {
        if (cv.text) return cv.text;
        else if (cv.family) {
          if (cv.given && Array.isArray(cv.given)) {
            return cv.given.reduce((a,c) => a + ' ' + c,'') + ' ' + cv.family;
          } else return cv.family;
        }
        else return acc;
      } else return acc;
    }, name);
  } // TODO: Else throw error
  return name.trim();
}

/**
 * In some cases we need to serialize objects coming out of CQL expressions. This 
 * occurs when the target element is a string but what is being returned by a CQL 
 * expression is an object (tuple or list). This function determines whether the 
 * value returned from CQL should be stringified or not.
 * @param {string} elementPath - The path to an element on a FHIR resource. 
 * @param elementValue - The value of the element
 * @returns {boolean} - Whether elementValue should be stringified
 */
export function shouldTryToStringify(elementPath, elementValue) {
  // NOTE: We *could* try to use the ModelInfo object provided by the cql-exec-fhir 
  // library to determine if the element specified by elementPath is supposed to 
  // be a string. The advantage of this approach is that it opens the door to more 
  // general kinds of type checking. But it is also complicated and doesn't cover 
  // the case where elementPath points to a choice element which could be but is 
  // not necessarily a string.
  //
  // Instead, we will assume that the type has been specified using the 
  // [ofType() function](https://hl7.org/fhirpath/#oftypetype-type-specifier-collection).
  // This is [explicitly allowed for choice elements](https://hl7.org/fhirpath/#paths-and-polymorphic-items) 
  // and is valid for non choice elements as well. Plus, ofType() is part of the 
  // [simple FHIRPath](https://www.hl7.org/fhir/fhirpath.html#simple) allowed in 
  // path.
  if (elementPath) {
    if (
      /ofType\(string\)$/.test(elementPath) &&
      typeof elementValue != 'string'
    ) return true;
    else return false;
  } else {
    return false;
  }
}

/**
 * Takes a FHIRPath to a choice element and converts the element name to include 
 * the appropriate type. This function is needed because in FHIRPath choice elements 
 * [do not include type as part of their name](https://hl7.org/fhirpath/#paths-and-polymorphic-items).
 * But choice elements in our generated FHIR resources must include their type 
 * [in their names](https://www.hl7.org/fhir/formats.html#choice).
 * @param {string} resource - Type of FHIR resource
 * @param {string} path - Path to a choice element
 * @returns {string}
 */
export function transformChoicePaths(resource, path) {

  // Iterate over the path segments and remove any array brackets and indices.
  // E.g., a.b[0].c --> a.b.c.
  let pathSegments = path.split('.').reduce((acc, cv) => {
    let element = cv.split('[')[0]
    if (/ofType\(string\)$/.test(element)) return acc;
    else return acc + '.' + element;
  },'');

  // Remove the extraneous '.' at the end and append an '[x]'
  // E.g., a.b.c. --> a.b.c[x]
  let potentialChoiceType = resource + pathSegments + '[x]';

  // Check if this path corresponds to one of the published choice types.
  if (potentialChoiceType in publishedFhirChoiceTypes.elements) {
    // If it is a choice type, check to ensure a type has been specified via 'ofType()'.
    if (/ofType\(\w+\)$/.test(path)) {
      let type = /ofType\((\w+)\)$/.exec(path)[1];
      // Check if this is a valid choice for this element
      if (publishedFhirChoiceTypes.elements[potentialChoiceType].includes(type)) {
        // Strip the trailing 'ofType()' from the path and append the type name
        let updatedPath = path.split('.ofType')[0] + type[0].toUpperCase() + type.slice(1);
        return updatedPath;
      } else {
        // TODO: Throw error
      }
    } else {
      // TODO: Throw error
    }
  } else {
    return path;
  }

}

/**
 * Takes a path of the form 'a.b.c[#].d' and a value and outputs a valid object:
 * {a:{b:{c:[{d:value}]}}}.
 * @param {*} path - Path to an element
 * @param {*} value - The value of the element
 * @returns {object}
 */
export function expandPathAndValue(path, value) {
  // Split the path string along the dots ('.') and construct the opening and 
  // closing brackets.
  let jsonStringComponents = path.split('.').reduce((acc, cv) => {
    // NOTE: If we see an opening square bracket ('['), assume this is an array 
    // with a single element.
    if (/\[/.test(cv)) {
      let arrayParts = cv.split('[');
      let arrayName = arrayParts[0];
      return {
        open: acc.open + `{"${arrayName}":[`,
        close: ']}' + acc.close
      }
    } else if (/ofType\(string\)$/.test(cv)) {
      return { // NOTE: Skip this part of the path if it is just a type specifier.
        open: acc.open,
        close: acc.close
      };
    } else {
      return {
        open: acc.open + `{"${cv}":`,
        close: '}' + acc.close
      }
    }
  }, {
    open: '',
    close: ''
  });

  // Sandwich the value in between the open and closing components.
  let jsonString = jsonStringComponents.open + 
    JSON.stringify(value) + 
    jsonStringComponents.close;

  // Parse the JSON string.
  let expandedObject = JSON.parse(jsonString);
  return expandedObject;
}

// From: https://www.hl7.org/fhir/choice-elements.json
const publishedFhirChoiceTypes = {
  "elements" : {
    "Annotation.author[x]": ["Reference", "string"],
    "DataRequirement.subject[x]": ["CodeableConcept", "Reference"],
    "DataRequirement.dateFilter.value[x]": ["dateTime", "Period", "Duration"],
    "Dosage.asNeeded[x]": ["boolean", "CodeableConcept"],
    "Dosage.doseAndRate.dose[x]": ["Range", "SimpleQuantity"],
    "Dosage.doseAndRate.rate[x]": ["Ratio", "Range", "SimpleQuantity"],
    "Population.age[x]": ["Range", "CodeableConcept"],
    "SubstanceAmount.amount[x]": ["Quantity", "Range", "string"],
    "Timing.repeat.bounds[x]": ["Duration", "Range", "Period"],
    "TriggerDefinition.timing[x]": ["Timing", "Reference", "date", "dateTime"],
    "UsageContext.value[x]": ["CodeableConcept", "Quantity", "Range", "Reference"],
    "ActivityDefinition.subject[x]": ["CodeableConcept", "Reference"],
    "ActivityDefinition.timing[x]": ["Timing", "dateTime", "Age", "Period", "Range", "Duration"],
    "ActivityDefinition.product[x]": ["Reference", "CodeableConcept"],
    "AllergyIntolerance.onset[x]": ["dateTime", "Age", "Period", "Range", "string"],
    "AuditEvent.entity.detail.value[x]": ["string", "base64Binary"],
    "BiologicallyDerivedProduct.collection.collected[x]": ["dateTime", "Period"],
    "BiologicallyDerivedProduct.processing.time[x]": ["dateTime", "Period"],
    "BiologicallyDerivedProduct.manipulation.time[x]": ["dateTime", "Period"],
    "CarePlan.activity.detail.scheduled[x]": ["Timing", "Period", "string"],
    "CarePlan.activity.detail.product[x]": ["CodeableConcept", "Reference"],
    "ChargeItem.occurrence[x]": ["dateTime", "Period", "Timing"],
    "ChargeItem.product[x]": ["Reference", "CodeableConcept"],
    "Claim.supportingInfo.timing[x]": ["date", "Period"],
    "Claim.supportingInfo.value[x]": ["boolean", "string", "Quantity", "Attachment", "Reference"],
    "Claim.diagnosis.diagnosis[x]": ["CodeableConcept", "Reference"],
    "Claim.procedure.procedure[x]": ["CodeableConcept", "Reference"],
    "Claim.accident.location[x]": ["Address", "Reference"],
    "Claim.item.serviced[x]": ["date", "Period"],
    "Claim.item.location[x]": ["CodeableConcept", "Address", "Reference"],
    "ClaimResponse.addItem.serviced[x]": ["date", "Period"],
    "ClaimResponse.addItem.location[x]": ["CodeableConcept", "Address", "Reference"],
    "ClinicalImpression.effective[x]": ["dateTime", "Period"],
    "CodeSystem.concept.property.value[x]": ["code", "Coding", "string", "integer", "boolean", "dateTime", "decimal"],
    "Communication.payload.content[x]": ["string", "Attachment", "Reference"],
    "CommunicationRequest.payload.content[x]": ["string", "Attachment", "Reference"],
    "CommunicationRequest.occurrence[x]": ["dateTime", "Period"],
    "Composition.relatesTo.target[x]": ["Identifier", "Reference"],
    "ConceptMap.source[x]": ["uri", "canonical"],
    "ConceptMap.target[x]": ["uri", "canonical"],
    "Condition.onset[x]": ["dateTime", "Age", "Period", "Range", "string"],
    "Condition.abatement[x]": ["dateTime", "Age", "Period", "Range", "string"],
    "Consent.source[x]": ["Attachment", "Reference"],
    "Contract.topic[x]": ["CodeableConcept", "Reference"],
    "Contract.term.topic[x]": ["CodeableConcept", "Reference"],
    "Contract.term.offer.answer.value[x]": ["boolean", "decimal", "integer", "date", "dateTime", "time", "string", "uri", "Attachment", "Coding", "Quantity", "Reference"],
    "Contract.term.asset.valuedItem.entity[x]": ["CodeableConcept", "Reference"],
    "Contract.term.action.occurrence[x]": ["dateTime", "Period", "Timing"],
    "Contract.friendly.content[x]": ["Attachment", "Reference"],
    "Contract.legal.content[x]": ["Attachment", "Reference"],
    "Contract.rule.content[x]": ["Attachment", "Reference"],
    "Contract.legallyBinding[x]": ["Attachment", "Reference"],
    "Coverage.costToBeneficiary.value[x]": ["SimpleQuantity", "Money"],
    "CoverageEligibilityRequest.serviced[x]": ["date", "Period"],
    "CoverageEligibilityRequest.item.diagnosis.diagnosis[x]": ["CodeableConcept", "Reference"],
    "CoverageEligibilityResponse.serviced[x]": ["date", "Period"],
    "CoverageEligibilityResponse.insurance.item.benefit.allowed[x]": ["unsignedInt", "string", "Money"],
    "CoverageEligibilityResponse.insurance.item.benefit.used[x]": ["unsignedInt", "string", "Money"],
    "DetectedIssue.identified[x]": ["dateTime", "Period"],
    "DeviceDefinition.manufacturer[x]": ["string", "Reference"],
    "DeviceRequest.code[x]": ["Reference", "CodeableConcept"],
    "DeviceRequest.parameter.value[x]": ["CodeableConcept", "Quantity", "Range", "boolean"],
    "DeviceRequest.occurrence[x]": ["dateTime", "Period", "Timing"],
    "DeviceUseStatement.timing[x]": ["Timing", "Period", "dateTime"],
    "DiagnosticReport.effective[x]": ["dateTime", "Period"],
    "EventDefinition.subject[x]": ["CodeableConcept", "Reference"],
    "EvidenceVariable.characteristic.definition[x]": ["Reference", "canonical", "CodeableConcept", "Expression", "DataRequirement", "TriggerDefinition"],
    "EvidenceVariable.characteristic.participantEffective[x]": ["dateTime", "Period", "Duration", "Timing"],
    "ExplanationOfBenefit.supportingInfo.timing[x]": ["date", "Period"],
    "ExplanationOfBenefit.supportingInfo.value[x]": ["boolean", "string", "Quantity", "Attachment", "Reference"],
    "ExplanationOfBenefit.diagnosis.diagnosis[x]": ["CodeableConcept", "Reference"],
    "ExplanationOfBenefit.procedure.procedure[x]": ["CodeableConcept", "Reference"],
    "ExplanationOfBenefit.accident.location[x]": ["Address", "Reference"],
    "ExplanationOfBenefit.item.serviced[x]": ["date", "Period"],
    "ExplanationOfBenefit.item.location[x]": ["CodeableConcept", "Address", "Reference"],
    "ExplanationOfBenefit.addItem.serviced[x]": ["date", "Period"],
    "ExplanationOfBenefit.addItem.location[x]": ["CodeableConcept", "Address", "Reference"],
    "ExplanationOfBenefit.benefitBalance.financial.allowed[x]": ["unsignedInt", "string", "Money"],
    "ExplanationOfBenefit.benefitBalance.financial.used[x]": ["unsignedInt", "Money"],
    "FamilyMemberHistory.born[x]": ["Period", "date", "string"],
    "FamilyMemberHistory.age[x]": ["Age", "Range", "string"],
    "FamilyMemberHistory.deceased[x]": ["boolean", "Age", "Range", "date", "string"],
    "FamilyMemberHistory.condition.onset[x]": ["Age", "Range", "Period", "string"],
    "Goal.start[x]": ["date", "CodeableConcept"],
    "Goal.target.detail[x]": ["Quantity", "Range", "CodeableConcept", "string", "boolean", "integer", "Ratio"],
    "Goal.target.due[x]": ["date", "Duration"],
    "Group.characteristic.value[x]": ["CodeableConcept", "boolean", "Quantity", "Range", "Reference"],
    "GuidanceResponse.module[x]": ["uri", "canonical", "CodeableConcept"],
    "Immunization.occurrence[x]": ["dateTime", "string"],
    "Immunization.protocolApplied.doseNumber[x]": ["positiveInt", "string"],
    "Immunization.protocolApplied.seriesDoses[x]": ["positiveInt", "string"],
    "ImmunizationEvaluation.doseNumber[x]": ["positiveInt", "string"],
    "ImmunizationEvaluation.seriesDoses[x]": ["positiveInt", "string"],
    "ImmunizationRecommendation.recommendation.doseNumber[x]": ["positiveInt", "string"],
    "ImmunizationRecommendation.recommendation.seriesDoses[x]": ["positiveInt", "string"],
    "ImplementationGuide.definition.resource.example[x]": ["boolean", "canonical"],
    "ImplementationGuide.definition.page.name[x]": ["url", "Reference"],
    "ImplementationGuide.manifest.resource.example[x]": ["boolean", "canonical"],
    "Invoice.lineItem.chargeItem[x]": ["Reference", "CodeableConcept"],
    "Library.subject[x]": ["CodeableConcept", "Reference"],
    "Measure.subject[x]": ["CodeableConcept", "Reference"],
    "Media.created[x]": ["dateTime", "Period"],
    "Medication.ingredient.item[x]": ["CodeableConcept", "Reference"],
    "MedicationAdministration.medication[x]": ["CodeableConcept", "Reference"],
    "MedicationAdministration.effective[x]": ["dateTime", "Period"],
    "MedicationAdministration.dosage.rate[x]": ["Ratio", "SimpleQuantity"],
    "MedicationDispense.statusReason[x]": ["CodeableConcept", "Reference"],
    "MedicationDispense.medication[x]": ["CodeableConcept", "Reference"],
    "MedicationKnowledge.ingredient.item[x]": ["CodeableConcept", "Reference"],
    "MedicationKnowledge.administrationGuidelines.indication[x]": ["CodeableConcept", "Reference"],
    "MedicationKnowledge.administrationGuidelines.patientCharacteristics.characteristic[x]": ["CodeableConcept", "SimpleQuantity"],
    "MedicationKnowledge.drugCharacteristic.value[x]": ["CodeableConcept", "string", "SimpleQuantity", "base64Binary"],
    "MedicationRequest.reported[x]": ["boolean", "Reference"],
    "MedicationRequest.medication[x]": ["CodeableConcept", "Reference"],
    "MedicationRequest.substitution.allowed[x]": ["boolean", "CodeableConcept"],
    "MedicationStatement.medication[x]": ["CodeableConcept", "Reference"],
    "MedicationStatement.effective[x]": ["dateTime", "Period"],
    "MedicinalProduct.specialDesignation.indication[x]": ["CodeableConcept", "Reference"],
    "MedicinalProductAuthorization.procedure.date[x]": ["Period", "dateTime"],
    "MedicinalProductContraindication.otherTherapy.medication[x]": ["CodeableConcept", "Reference"],
    "MedicinalProductIndication.otherTherapy.medication[x]": ["CodeableConcept", "Reference"],
    "MedicinalProductInteraction.interactant.item[x]": ["Reference", "CodeableConcept"],
    "MessageDefinition.event[x]": ["Coding", "uri"],
    "MessageHeader.event[x]": ["Coding", "uri"],
    "NutritionOrder.enteralFormula.administration.rate[x]": ["SimpleQuantity", "Ratio"],
    "Observation.effective[x]": ["dateTime", "Period", "Timing", "instant"],
    "Observation.value[x]": ["Quantity", "CodeableConcept", "string", "boolean", "integer", "Range", "Ratio", "SampledData", "time", "dateTime", "Period"],
    "Observation.component.value[x]": ["Quantity", "CodeableConcept", "string", "boolean", "integer", "Range", "Ratio", "SampledData", "time", "dateTime", "Period"],
    "Patient.deceased[x]": ["boolean", "dateTime"],
    "Patient.multipleBirth[x]": ["boolean", "integer"],
    "PlanDefinition.subject[x]": ["CodeableConcept", "Reference"],
    "PlanDefinition.goal.target.detail[x]": ["Quantity", "Range", "CodeableConcept"],
    "PlanDefinition.action.subject[x]": ["CodeableConcept", "Reference"],
    "PlanDefinition.action.relatedAction.offset[x]": ["Duration", "Range"],
    "PlanDefinition.action.timing[x]": ["dateTime", "Age", "Period", "Duration", "Range", "Timing"],
    "PlanDefinition.action.definition[x]": ["canonical", "uri"],
    "Procedure.performed[x]": ["dateTime", "Period", "string", "Age", "Range"],
    "Provenance.occurred[x]": ["Period", "dateTime"],
    "Questionnaire.item.enableWhen.answer[x]": ["boolean", "decimal", "integer", "date", "dateTime", "time", "string", "Coding", "Quantity", "Reference"],
    "Questionnaire.item.answerOption.value[x]": ["integer", "date", "time", "string", "Coding", "Reference"],
    "Questionnaire.item.initial.value[x]": ["boolean", "decimal", "integer", "date", "dateTime", "time", "string", "uri", "Attachment", "Coding", "Quantity", "Reference"],
    "QuestionnaireResponse.item.answer.value[x]": ["boolean", "decimal", "integer", "date", "dateTime", "time", "string", "uri", "Attachment", "Coding", "Quantity", "Reference"],
    "RequestGroup.action.relatedAction.offset[x]": ["Duration", "Range"],
    "RequestGroup.action.timing[x]": ["dateTime", "Age", "Period", "Duration", "Range", "Timing"],
    "ResearchDefinition.subject[x]": ["CodeableConcept", "Reference"],
    "ResearchElementDefinition.subject[x]": ["CodeableConcept", "Reference"],
    "ResearchElementDefinition.characteristic.definition[x]": ["CodeableConcept", "canonical", "Expression", "DataRequirement"],
    "ResearchElementDefinition.characteristic.studyEffective[x]": ["dateTime", "Period", "Duration", "Timing"],
    "ResearchElementDefinition.characteristic.participantEffective[x]": ["dateTime", "Period", "Duration", "Timing"],
    "RiskAssessment.occurrence[x]": ["dateTime", "Period"],
    "RiskAssessment.prediction.probability[x]": ["decimal", "Range"],
    "RiskAssessment.prediction.when[x]": ["Period", "Range"],
    "ServiceRequest.quantity[x]": ["Quantity", "Ratio", "Range"],
    "ServiceRequest.occurrence[x]": ["dateTime", "Period", "Timing"],
    "ServiceRequest.asNeeded[x]": ["boolean", "CodeableConcept"],
    "Specimen.collection.collected[x]": ["dateTime", "Period"],
    "Specimen.collection.fastingStatus[x]": ["CodeableConcept", "Duration"],
    "Specimen.processing.time[x]": ["dateTime", "Period"],
    "Specimen.container.additive[x]": ["CodeableConcept", "Reference"],
    "SpecimenDefinition.typeTested.container.minimumVolume[x]": ["SimpleQuantity", "string"],
    "SpecimenDefinition.typeTested.container.additive.additive[x]": ["CodeableConcept", "Reference"],
    "StructureMap.group.rule.source.defaultValue[x]": ["*"],
    "StructureMap.group.rule.target.parameter.value[x]": ["id", "string", "boolean", "integer", "decimal"],
    "Substance.ingredient.substance[x]": ["CodeableConcept", "Reference"],
    "SubstanceReferenceInformation.target.amount[x]": ["Quantity", "Range", "string"],
    "SubstanceSpecification.moiety.amount[x]": ["Quantity", "string"],
    "SubstanceSpecification.property.definingSubstance[x]": ["Reference", "CodeableConcept"],
    "SubstanceSpecification.property.amount[x]": ["Quantity", "string"],
    "SubstanceSpecification.relationship.substance[x]": ["Reference", "CodeableConcept"],
    "SubstanceSpecification.relationship.amount[x]": ["Quantity", "Range", "Ratio", "string"],
    "SupplyDelivery.suppliedItem.item[x]": ["CodeableConcept", "Reference"],
    "SupplyDelivery.occurrence[x]": ["dateTime", "Period", "Timing"],
    "SupplyRequest.item[x]": ["CodeableConcept", "Reference"],
    "SupplyRequest.parameter.value[x]": ["CodeableConcept", "Quantity", "Range", "boolean"],
    "SupplyRequest.occurrence[x]": ["dateTime", "Period", "Timing"],
    "Task.input.value[x]": ["*"],
    "Task.output.value[x]": ["*"],
    "ValueSet.expansion.parameter.value[x]": ["string", "boolean", "integer", "decimal", "uri", "code", "dateTime"]
  }
};