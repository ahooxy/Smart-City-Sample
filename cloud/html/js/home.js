
function format_sensor_tooltip(template, sensor) {
    $.each(template.find("td[field]"),function (x,v) {
        $(v).text(sensor._source[$(v).attr("field")]);
    });
    template.find("[location]").text("["+sensor._source.location.lat.toFixed(3)+","+sensor._source.location.lon.toFixed(3)+"]");
    template.find("[resolution]").text(sensor._source.resolution.width+"x"+sensor._source.resolution.height);
    return template.html();
}

$("#pg-home").on(":initpage", function(e) {
    var page=$(this);
    $("#layoutButton").hide();
    $("#cloudButton").hide();

    /* create map */
    var map=page.data('map');
    if (!map) {
        page.data('zoom', 15);
        page.data('offices',{});
        page.data('sensors',{});
        page.data('queries',"sensor=*");

        /* create map */
        map=L.map("mapCanvas",{ zoom: page.data('zoom'), minZoom: 13 });
        page.data('map',map);

        /* add layers switching widget */
        page.data('heatmap',{ name: "Density Estimation", layer: L.layerGroup() });
        page.data('stat',{ name: "Statistics Histogram", layer: L.layerGroup() });
        page.data('preview', { name: "Preview Clips", layer: L.layerGroup() });
        page.data('alert', { name: "Scrolling Alerts", layer: L.layerGroup() });
        page.data('controls', L.control.layers().addTo(map));
        alerts.setup(page);

        /* add tiles */
        $.each(scenarios.setting, function (i,sc) {
            scenarios[sc].setup(i,page,map);
        });

        map.on('zoomend', function () {
            var update_layer=function (layer) {
                var z=layer._zoomargs;
                if (!z) return;
                var scale=Math.pow(2.0,map.getZoom()-z.zoom);
                var width=Math.floor(z.width*scale);
                var height=Math.floor(z.height*scale);
                $(layer._icon).css({width:width+'px',height:height+'px'});
            };
            page.data('stat').layer.eachLayer(update_layer);
            page.data('preview').layer.eachLayer(update_layer);
        });
    }

    /* enable the office button */
    var search=$("#homeSearch");
    $("#homeButton").unbind('click').click(function () {
        map.setView(page.data('scenario').center, page.data('zoom'));
    });

    /* update map with the sensor info */
    var index="sensors";
    var update=function (queries) {
        if (!page.is(":visible")) return;
        page.data('queries',queries);
 
        /* remove any old timer */
        var timer=page.data('timer');
        if (timer) clearTimeout(timer);

        var center=map.getCenter();
        apiHost.search(index,"("+queries+") and location:["+center.lat+","+center.lng+","+settings.radius()+"]",null).then(function (data) {
            var offices=page.data('offices');
            var sensors=page.data('sensors');
            var scenario=page.data('scenario');

            $.each(data.response, function (x,sensor) {
                var officeid=sensor._source.office.lat+","+sensor._source.office.lon;
                if (!(officeid in offices)) {
                    offices[officeid]={
                        office: sensor._source.office,
                        marker: L.marker(sensor._source.office, { 
                            icon: scenario.icon.office,
                            riseOnHover: true,
                        }).addTo(map),
                    };
                }

                /* setup office address & tooltip */
                var officectx=offices[officeid];
                officectx.used=true;
                if (!("address" in officectx)) {
                    apiHost.search('offices','location:['+officeid+']',null,1).then(function (data) {
                        if (data.response.length==0) return;
                        officectx.address=data.response[0]._source.address;

                        /* setup marker actions */
                        officectx.marker.bindTooltip(officectx.address+' @ ['+officeid+']').on('click', function () {
                            $("#office").data("ctx",officectx);
                            $("#office").foundation('open');
                        });
                    }).catch(function () {
                    });
                }

                var sensorid=sensor._source.location.lat+","+sensor._source.location.lon;
                if (!(sensorid in sensors)) {
                    sensors[sensorid]={ 
                        address: sensor._source.address,
                    };
                    var sensorctx=sensors[sensorid];
                    sensorctx.marker=L.marker(sensor._source.location,{
                        icon: scenario.icon.sensor_icon(sensor),
                        riseOnHover: true,
                        rotationAngle: scenario.icon.sensor_icon_rotation(sensor),
                        rotationOrigin: "center",
                    }).on({
                        'dblclick': function(e) {
                            e.stopPropagation();
                            selectPage("recording",['sensor="'+sensor._id+'"',sensor._source.office]);
                        },
                        'popupopen': function () {
                            sensorctx.marker.unbindTooltip();
                        },
                        'popupclose': function () {
                            sensorctx.marker.bindTooltip(sensorctx.title);
                        },
                    }).addTo(map);
                    scenario.create_sensor(officectx, sensorctx, sensor, map);
                    preview.create(sensorctx, sensor, page, map);
		            stats.create(sensorctx, sensor, page, map);
                    heatmap.create(sensorctx, sensor._source.location);
                }

                /* update sensor */
                var sensorctx=sensors[sensorid];
                sensorctx.used=true;

                /* update sensor info */
                scenario.update_sensor(sensorctx, sensor);
                var tooltip=format_sensor_tooltip(page.find("[sensor-info-template]").clone().removeAttr('sensor-info_template').show(),sensor);
                if (sensorctx.tooltip!=tooltip) {
                    sensorctx.tooltip=tooltip;
                    sensorctx.marker.unbindTooltip().bindTooltip(tooltip);
                }

                /* show bubble stats */
                var stat_layer=page.data('stat').layer;
                if (map.hasLayer(stat_layer)) 
                    stats.update(stat_layer, sensorctx, map.getZoom(), sensor);

                /* show heatmap */
                var heatmap_layer=page.data('heatmap').layer;
                if (map.hasLayer(heatmap_layer)) 
                    heatmap.update(heatmap_layer, sensorctx, map.getZoom(), sensor);
            });

            /* remove obsolete markers */
            $.each(sensors, function (x,v) {
                if ("used" in v) {
                    delete v.used;
                } else {
                    sensorctx.marker.remove();
                    scenario.close_sensor(v);
                    preview.close(v);
		            stats.close(v);
                    heatmap.close(v);
                    delete sensors[x];
                }
            });
            $.each(offices, function (x,v) {
                if ("used" in v) {
                    delete v.used;
                } else {
                    map.removeLayer(v.marker);
                    delete offices[x];
                }
            });
            page.data('timer',setTimeout(update,settings.sensor_update(),queries));
        }).catch(function (e) {
            $("[hint-panel]").trigger(":error", [e.statusText]);
            page.data('timer',setTimeout(update,settings.sensor_update(),queries));
        });
    };

    /* enable sensor queries */
    search.val(page.data("queries")).data('index',index).data('office',null).data('invoke',update).focus().trigger($.Event("keydown",{keyCode:13}));

}).on(":closepage",function() {
    var page=$(this);
    var timer=page.data('timer');
    if (timer) clearTimeout(timer);
});
