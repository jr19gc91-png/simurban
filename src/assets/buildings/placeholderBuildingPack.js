// Starter pack 3D procedural do NewCore.
// Mantém o fluxo combinado: construções são criadas/validadas separadas e implantadas como pack.
// Aqui ficam apenas definições; o BuildingSystem escolhe fábrica/footprint/densidade e renderiza.
export const placeholderBuildingPack = {
  id: 'procedural-br-newcore-v1-1',
  name: 'Procedural BR NewCore Starter Pack',
  version: '0.9',
  definitions: [
    { id: 'res-casa-muro-01', zone: 'residential', density: 'low', footprint: [4, 4], factory: 'procedural-br-house' },
    { id: 'res-casa-garagem-02', zone: 'residential', density: 'low', footprint: [4, 4], factory: 'procedural-br-house' },
    { id: 'res-sobrado-03', zone: 'residential', density: 'low', footprint: [4, 4], factory: 'procedural-br-house' },
    { id: 'res-sobrado-geminado-04', zone: 'residential', density: 'low', footprint: [4, 4], factory: 'procedural-br-house' },
    { id: 'res-vila-05', zone: 'residential', density: 'low', footprint: [4, 3], factory: 'procedural-br-house' },
    { id: 'res-casa-laje-06', zone: 'residential', density: 'low', footprint: [4, 4], factory: 'procedural-br-house' },
    { id: 'res-predinho-07', zone: 'residential', density: 'medium', footprint: [4, 4], factory: 'procedural-br-house' },
    { id: 'res-predinho-varanda-08', zone: 'residential', density: 'medium', footprint: [5, 4], factory: 'procedural-br-house' },

    { id: 'com-loja-bairro-01', zone: 'commercial', density: 'low', footprint: [4, 4], factory: 'procedural-br-commerce' },
    { id: 'com-padaria-02', zone: 'commercial', density: 'low', footprint: [4, 4], factory: 'procedural-br-commerce' },
    { id: 'com-mercadinho-03', zone: 'commercial', density: 'low', footprint: [5, 4], factory: 'procedural-br-commerce' },
    { id: 'com-galeria-04', zone: 'commercial', density: 'low', footprint: [5, 4], factory: 'procedural-br-commerce' },
    { id: 'com-posto-lojas-05', zone: 'commercial', density: 'low', footprint: [6, 4], factory: 'procedural-br-commerce' },
    { id: 'com-predinho-06', zone: 'commercial', density: 'medium', footprint: [4, 4], factory: 'procedural-br-commerce' },
    { id: 'com-clinica-07', zone: 'commercial', density: 'medium', footprint: [5, 4], factory: 'procedural-br-commerce' },
    { id: 'com-escritorio-08', zone: 'commercial', density: 'medium', footprint: [5, 5], factory: 'procedural-br-commerce' },

    { id: 'ind-galpao-01', zone: 'industrial', density: 'low', footprint: [6, 4], factory: 'procedural-br-industrial' },
    { id: 'ind-oficina-02', zone: 'industrial', density: 'low', footprint: [5, 4], factory: 'procedural-br-industrial' },
    { id: 'ind-deposito-03', zone: 'industrial', density: 'low', footprint: [6, 5], factory: 'procedural-br-industrial' },
    { id: 'ind-logistica-04', zone: 'industrial', density: 'low', footprint: [7, 5], factory: 'procedural-br-industrial' },
    { id: 'ind-fabrica-05', zone: 'industrial', density: 'medium', footprint: [8, 5], factory: 'procedural-br-industrial' },
    { id: 'ind-metalurgica-06', zone: 'industrial', density: 'medium', footprint: [8, 6], factory: 'procedural-br-industrial' },
    { id: 'ind-armazem-07', zone: 'industrial', density: 'low', footprint: [7, 4], factory: 'procedural-br-industrial' },
    { id: 'ind-terminal-08', zone: 'industrial', density: 'medium', footprint: [8, 6], factory: 'procedural-br-industrial' }
  ]
};
