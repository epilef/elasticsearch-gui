'use strict';

/* Services */
var serviceModule = angular.module('myApp.services', []);
serviceModule.value('version', '0.9');

serviceModule.factory('elastic', ['serverConfig','esFactory', function (serverConfig, esFactory) {
    function ElasticService(serverConfig, esFactory) {
        var serverUrl = serverConfig.host;
        var statussus = {"green": "success", "yellow": "warning", "red": "error"};
        var es = esFactory({"host": serverUrl});

        this.changeServerAddress = function (serverAddress) {
            serverUrl = serverAddress;
            es = esFactory({"host": serverUrl})
        };

        this.obtainServerAddress = function () {
            return serverUrl;
        };

        this.clusterStatus = function (callback) {
            es.cluster.health({}).then(function(data) {
                var numClients = data.number_of_nodes - data.number_of_data_nodes;
                var msg = data.cluster_name + " [nodes: " + data.number_of_nodes + ", clients: " + numClients + "]";
                callback(msg, statussus[data.status]);                    
            }, function(reason) {
                console.log(reason);
                callback("No connection", "error");
            });
        };

        this.clusterName = function (callback) {
            es.cluster.health().then(function(data) {
                callback(data.cluster_name);
            });
        };

        this.clusterHealth = function (callback) {
            es.cluster.health().then(function(data) {
                callback(data);
            });
        };

        this.clusterNodes = function (callback) {
            es.cluster.nodeInfo().then(function (data) {
                callback(data.nodes);
            });
        };

        this.plugins = function (callback) {
            es.cluster.nodeInfo({"plugin":true}).then(function(data) {
                var nodes = [];
                angular.forEach(data.nodes, function (node,node_id) {
                    var siteNode = {};
                    siteNode.name = node.name;
                    siteNode.plugins = [];
                    var httpAddress = node.http_address.substring(6,node.http_address.length-1);
                    angular.forEach(node.plugins, function(plugin) {
                        if (plugin.site) {
                            var sitePlugin = {};
                            sitePlugin.url = 'http://'+ httpAddress + plugin.url;
                            sitePlugin.name = plugin.name;
                            siteNode.plugins.push(sitePlugin);
                        }
                    })
                    nodes.push(siteNode);
                });
                callback(nodes);
            });
        };

        this.nodeInfo = function (nodeId, callback) {
            es.cluster.nodeInfo({"all":true,"nodeId":nodeId}).then(function (data) {
                callback(data.nodes[nodeId]);
            });
        };

        this.indexes = function (callback) {
            es.indices.status({}).then(function (data) {
                var indices = [];
                for (var index in data.indices) {
                    indices.push(index);
                }
                callback(indices);
            });
        };

        this.removeIndex = function (index, callback) {
            es.indices.delete({"index":index}).then(function(data) {
                callback();
            });
        };

        this.openIndex = function (index, callback) {
            es.indices.open({"index":index}).then(function(data) {
                callback();
            });
        };

        this.closeIndex = function (index, callback) {
            es.indices.close({"index":index}).then(function(data) {
                callback();
            });
        };

        this.indexesDetails = function (callback) {
            es.indices.status().then(function (statusData) {
                var indexesStatus = statusData.indices;
                var stateFilter = {};
                stateFilter.filterRoutingTable = true;
                stateFilter.filterNodes = true;
                stateFilter.filterBlocks = true;

                es.cluster.state(stateFilter).then(function(stateData) {
                    var indexesState = stateData.metadata.indices;
                    var indices = [];
                    angular.forEach(indexesState, function(value,key) {
                        var newIndex = {};
                        newIndex.name = key;
                        newIndex.numShards = value.settings['index.number_of_shards'];
                        if (value.state === 'open') {
                            newIndex.size = indexesStatus[key].index.size;
                            newIndex.numDocs = indexesStatus[key].docs.num_docs;
                            newIndex.state = true;
                        } else {
                            newIndex.state = false;
                        }
                        indices.push(newIndex);
                    });
                    callback(indices);
                });
            });
        };

        this.types = function (selectedIndex, callback) {
            var mappingFilter = {};
            if (selectedIndex.length > 0) {
                mappingFilter.index = selectedIndex.toString();
            }
            es.indices.getMapping(mappingFilter).then(function (data) {
                var myTypes = [];
                for (var index in data) {
                    for (var type in data[index]) {
                        if (myTypes.indexOf(type) == -1 && type != "_default_") {
                            myTypes.push(type);
                        }
                    }
                }
                callback(myTypes);
            });
        };

        this.fields = function (selectedIndex, selectedType, callback) {
            var mappingFilter = {};
            if (selectedIndex.length > 0) {
                mappingFilter.index = selectedIndex.toString();
            }
            if (selectedType.length > 0) {
                // if (!selectedIndex.length > 0) {
                //     url += "/*";
                // }
                mappingFilter.type = selectedType.toString();
            }
            es.indices.getMapping(mappingFilter).then(function (data) {
                var myTypes = [];
                var myFields = {};
                for (var index in data) {
                    /*
                     * Structure of result with one index is different from the other results. usually you first
                     * get the index, in this special case you immediately get the type.
                     */
                    if (index == selectedType) {
                        myTypes.push(index);
                        var properties = data[index].properties;
                        for (var field in properties) {
                            handleSubfields(properties[field], field, myFields, undefined);
                        }
                    } else {
                        for (var type in data[index]) {
                            if (myTypes.indexOf(type) == -1 && type != "_default_") {
                                myTypes.push(type);
                                var properties = data[index][type].properties;
                                for (var field in properties) {
                                    handleSubfields(properties[field], field, myFields, undefined);
                                }
                            }
                        }
                    }
                }
                callback(myFields);
            });
        };

        function handleSubfields(field, fieldName, myFields, nestedPath) {
            if (field.hasOwnProperty("properties")) {
                var nested = (field.type == "nested" | field.type == "object");
                if (nested) {
                    nestedPath = fieldName;
                }
                for (var subField in field.properties) {
                    var newField = fieldName + "." + subField;
                    handleSubfields(field.properties[subField], newField, myFields, nestedPath);
                }
            } else {
                if (field.type === "multi_field") {
                    for (var multiField in field.fields) {
                        var multiFieldName = fieldName + "." + multiField;
                        // TODO jettro : fix the nested documents with multi_fields
                        if (!myFields[multiFieldName] && fieldName !== multiField) {
                            myFields[multiFieldName] = field.fields[multiField];
                            myFields[multiFieldName].nestedPath = nestedPath;
                            myFields[multiFieldName].forPrint = multiFieldName + " (" + field.type + ")";
                        }
                    }
                }
                if (!myFields[fieldName]) {
                    myFields[fieldName] = field;
                    myFields[fieldName].nestedPath = nestedPath;
                    myFields[fieldName].forPrint = fieldName + " (" + field.type + ")";
                }
            }
        }

        this.doSearch = function(query, resultCallback, errorCallback) {
            es.search(query).then(function(results) {
                resultCallback(results)
            }, function(errors) {
                errorCallback(errors)
            });
        };
    }

    return new ElasticService(serverConfig, esFactory);
}]);

serviceModule.factory('configuration', ['$rootScope', 'localStorage', function ($rootScope, localStorage) {
    function LocalStorageService(localStorage) {
        var LOCAL_STORAGE_ID = 'es-config',
                configurationString = localStorage[LOCAL_STORAGE_ID];

        var configuration = configurationString ? JSON.parse(configurationString) : {
            title: undefined,
            description: undefined
        };

        $rootScope.$watch(function () {
            return configuration;
        }, function () {
            localStorage[LOCAL_STORAGE_ID] = JSON.stringify(configuration);
        }, true);

        return configuration;
    }

    return new LocalStorageService(localStorage);
}]);

serviceModule.factory('queryStorage', ['localStorage', function (localStorage) {
    function QueryStorage(localStorage) {
        var LOCAL_STORAGE_ID_QUERY = 'es-query';
        var LOCAL_STORAGE_ID_SEARCH = 'es-search';

        this.loadQuery = function (callback) {
            var query = localStorage[LOCAL_STORAGE_ID_QUERY];
            callback(JSON.parse(query));
        };

        this.saveQuery = function (query) {
            localStorage[LOCAL_STORAGE_ID_QUERY] = JSON.stringify(query);
        };

        this.loadSearch = function (callback) {
            var search = localStorage[LOCAL_STORAGE_ID_SEARCH];
            callback(JSON.parse(search));
        };

        this.saveSearch = function (search) {
            localStorage[LOCAL_STORAGE_ID_SEARCH] = JSON.stringify(search);
        };
    }

    return new QueryStorage(localStorage);
}]);

serviceModule.factory('serverConfig', ['$location', function ($location) {
    function ServerConfig(location) {
        if (location.host() == 'www.gridshore.nl') {
            this.host = "http://localhost:9200";
        } else {
            this.host = location.protocol() + "://" + location.host() + ":" + location.port();
        }
    }

    return new ServerConfig($location);
}]);

serviceModule.factory('facetBuilder', function () {
    function FacetBuilder() {
        this.build = function (facets) {
            var queryfacets = {};

            for (var i = 0; i < facets.length; i++) {
                var facet = facets[i];
                if (facet.facetType === 'term') {
                    queryfacets[facet.field] = {"terms":{"field":facet.field}};
                } else if (facet.facetType === 'range') {
                    var ranges = [];
                    for (var j = 0; j < facet.ranges.length; j++) {
                        var range = facet.ranges[j];
                        if (range[0] == undefined) {
                            ranges.push({"to":range[1]})
                        } else if (range[1] == undefined) {
                            ranges.push({"from":range[0]})
                        } else {
                            ranges.push({"from":range[0],"to":range[1]});
                        }
                    }
                    queryfacets[facet.field]={"range":{"field":facet.field,"ranges":ranges}};
                } else if (facet.facetType === 'datehistogram') {
                    queryfacets[facet.field]={"date_histogram":{"field":facet.field,"interval":facet.interval}};
                } else if (facet.facetType === 'histogram') {
                    queryfacets[facet.field]={"histogram":{"field":facet.field,"interval":facet.interval}};
                }
            }
            return queryfacets;
        }
    }

    return new FacetBuilder();
});

serviceModule.factory('errorHandling', ['$rootScope', function ($rootScope) {
    function ErrorHandling(rootScope) {
        $rootScope.alerts = [];

        this.add = function(message) {
            if (message && typeof message === "object") {
                if (message.hasOwnProperty('message')) {
                    $rootScope.alerts.push({"msg":message.message});    
                }
            } else {
                $rootScope.alerts.push({"msg":message});
            }
        }

        this.clear = function() {
            $rootScope.alerts = [];
        }
    }

    return new ErrorHandling($rootScope);
}]);
