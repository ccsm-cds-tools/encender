library TestingCqlLibrary version '1.0.0'
using FHIR version '4.0.1'
include "FHIRHelpers" version '4.0.1'

define ReturnsTrue:
  true

define ReturnsFalse:
  false

define AlsoReturnsTrue:
  true

define AnotherTrueStatement:
  true

define ButIAmFalse:
  false

define AlsoFalseHere:
  false

define MathCalculation:
  40.0 + 2.0

define TrueMathStatement:
  MathCalculation > 0.0

define FalseMathStatement:
  MathCalculation < 0.0

define NestedMathCalculation:
  MathCalculation + 100.0

define NestedMathStatement:
  TrueMathStatement and
  (NestedMathCalculation > 0.0)

define AnotherNestedMathStatement:
  NestedMathStatement and
  (NestedMathCalculation < 0.0)

define ReturnsACode:
  {
    coding: {
      {
        system: 'http://snomed.info/sct',
        code: '10828004',
        display: 'Positive'
      }
    },
    text: 'I\'m something'
  }
