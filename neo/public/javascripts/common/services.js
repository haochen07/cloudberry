angular.module('cloudberry.common', [])
  .service('Asterix', function($http, $timeout, $location) {
    var startDate = new Date(2015, 10, 22, 0, 0, 0, 0);
    var defaultNonSamplingDayRange = 1500;
    var defaultSamplingDayRange = 1;
    var defaultSamplingSize = 10;
    var ws = new WebSocket("ws://" + $location.host() + ":" + $location.port() + "/ws");

    var countRequest = JSON.stringify({
      dataset: "twitter.ds_tweet",
      global: {
        globalAggregate: {
          field: "*",
          apply: {
            name: "count"
          },
          as: "count"
        }},
      estimable : true,
      transform: {
        wrap: {
          key: "totalCount"
        }
      }
    });

    function requestLiveCounts() {
      if(ws.readyState === ws.OPEN){
        ws.send(countRequest);
      }
    }
    setInterval(requestLiveCounts, 1000);

    function byGeoRequest(parameters) {
      return {
        dataset: parameters.dataset,
        filter: asterixService.getFilter(parameters, defaultNonSamplingDayRange),
        group: {
          by: [{
            field: "geo",
            apply: {
              name: "level",
              args: {
                level: parameters.geoLevel
              }
            },
            as: parameters.geoLevel
          }],
          aggregate: [{
            field: "*",
            apply: {
              name: "count"
            },
            as: "count"
          }]
        }
      };
    }

    function byTimeRequest(parameters) {
      return {
        dataset: parameters.dataset,
        filter: asterixService.getFilter(parameters, defaultNonSamplingDayRange),
        group: {
          by: [{
            field: "create_at",
            apply: {
              name: "interval",
              args: {
                unit: parameters.timeBin
              }
            },
            as: parameters.timeBin
          }],
          aggregate: [{
            field: "*",
            apply: {
              name: "count"
            },
            as: "count"
          }]
        }
      };
    }

    function byHashTagRequest(parameters) {
      return {
        dataset: parameters.dataset,
        filter: asterixService.getFilter(parameters, defaultNonSamplingDayRange),
        unnest: [{
          hashtags: "tag"
        }],
        group: {
          by: [{
            field: "tag"
          }],
          aggregate: [{
            field: "*",
            apply: {
              name: "count"
            },
            as: "count"
          }]
        },
        select: {
          order: ["-count"],
          limit: 50,
          offset: 0
        }
      };
    }

    var asterixService = {

      totalCount: 0,
      startDate: startDate,
      parameters: {
        dataset: "twitter.ds_tweet",
        keywords: [],
        timeInterval: {
          start: startDate,
          end: new Date()
        },
        timeBin : "day",
        geoLevel: "state",
        geoIds : [37,51,24,11,10,34,42,9,44,48,35,4,40,6,20,32,8,49,12,22,28,1,13,45,5,47,21,29,54,17,18,39,19,55,26,27,31,56,41,46,16,30,53,38,25,36,50,33,23,2]
      },

      queryType: "search",

      mapResult: [],
      timeResult: [],
      hashTagResult: [],
      errorMessage: null,

      query: function(parameters, queryType) {
        var sampleJson = (JSON.stringify({
          dataset: parameters.dataset,
          filter: this.getFilter(parameters, defaultSamplingDayRange),
          select: {
            order: ["-create_at"],
            limit: defaultSamplingSize,
            offset: 0,
            field: ["create_at", "id", "user.id"]
          },
          transform: {
            wrap: {
              key: "sample"
            }
          }
        }));

        var batchJson = (JSON.stringify({
          batch: [byTimeRequest(parameters), byGeoRequest(parameters), byHashTagRequest(parameters)],
          option: {
            sliceMillis: 2000
          },
          transform: {
            wrap: {
              key: "batch"
            }
          }
        }));

        ws.send(sampleJson);
        ws.send(batchJson);
      },

        /*

      byGeoRequest: function(parameters){
        return {
          dataset: parameters.dataset,
          filter: this.getFilter(parameters, defaultNonSamplingDayRange),
          group: {
            by: [{
              field: "geo",
              apply: {
                name: "level",
                args: {
                  level: parameters.geoLevel
                }
              },
              as: parameters.geoLevel
            }],
            aggregate: [{
              field: "*",
              apply: {
                name: "count"
              },
              as: "count"
            }]
          }
        };
      },

      byTimeRequest: function(parameters) {
        return {
          dataset: parameters.dataset,
          filter: this.getFilter(parameters, defaultNonSamplingDayRange),
          group: {
            by: [{
              field: "create_at",
              apply: {
                name: "interval",
                args: {
                  unit: parameters.timeBin
                }
              },
              as: parameters.timeBin
            }],
            aggregate: [{
              field: "*",
              apply: {
                name: "count"
              },
              as: "count"
            }]
          }
        };
      },

      byHashTagRequest: function(parameters) {
        return {
          dataset: parameters.dataset,
          filter: this.getFilter(parameters, defaultNonSamplingDayRange),
          unnest: [{
            hashtags: "tag"
          }],
          group: {
            by: [{
              field: "tag"
            }],
            aggregate: [{
              field: "*",
              apply: {
                name: "count"
              },
              as: "count"
            }]
          },
          select: {
            order: ["-count"],
            limit: 50,
            offset: 0
          }
        };
      },

*/

      getFilter: function(parameters, maxDay) {
        var spatialField = this.getLevel(parameters.geoLevel);
        var keywords = [];
        for(var i = 0; i < parameters.keywords.length; i++){
          keywords.push(parameters.keywords[i].replace("\"", "").trim());
        }
        var queryStartDate = new Date(parameters.timeInterval.end);
        queryStartDate.setDate(queryStartDate.getDate() - maxDay);
        queryStartDate = parameters.timeInterval.start > queryStartDate ? parameters.timeInterval.start : queryStartDate;

        return [
            {
              field: "geo_tag." + spatialField,
              relation: "in",
              values: parameters.geoIds
            }, {
              field: "create_at",
              relation: "inRange",
              values: [queryStartDate.toISOString(), parameters.timeInterval.end.toISOString()]
            }, {
              field: "text",
              relation: "contains",
              values: [this.mkString(keywords, ",")]
            }
        ];
      },

      getLevel: function(level){
        switch(level){
          case "state" : return "stateID";
          case "county" : return "countyID";
          case "city" : return "cityID";
        }
      },

      mkString: function(array, delimiter){
        var s = "";
        array.forEach(function (item) {
            s += item.toString() + delimiter;
        });
        return s.substring(0, s.length-1);
      }
    };

    ws.onmessage = function(event) {
      $timeout(function() {
        var result = JSONbig.parse(event.data);
        switch (result.key) {
          case "sample":
            asterixService.tweetResult = result.value[0];
            break;
          case "batch":
            asterixService.timeResult = result.value[0];
            asterixService.mapResult = result.value[1];
            asterixService.hashTagResult = result.value[2];
            break;
          case "totalCount":
            asterixService.totalCount = result.value[0][0].count;
            break;
          case "error":
            console.error(result.toString());
            asterixService.errorMessage = result.value;
            break;
          case "done":
            break;
          default:
            console.error("ws get unknown data: " + result.toString());
            asterixService.errorMessage = "ws get unknown data: " + result.toString();
            break;
        }
      });
    };

    return asterixService;
  });
