(function_declaration name: (identifier) @def.function)
(class_declaration name: (identifier) @def.class)
(method_definition name: (property_identifier) @def.method)

(call_expression function: (identifier) @call.name) @call.node
(call_expression function: (member_expression property: (property_identifier) @call.name)) @call.node

(import_statement source: (string) @import.source) @import.node
