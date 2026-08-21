(function_definition name: (identifier) @def.function)
(class_definition name: (identifier) @def.class)

(call function: (identifier) @call.name) @call.node
(call function: (attribute attribute: (identifier) @call.name)) @call.node

(import_statement) @import.node
(import_from_statement) @import.node
